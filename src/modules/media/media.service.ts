import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFolderDto, UpdateFolderDto, UpdateFileDto, MediaQueryDto } from './dto/media.dto';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class MediaService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * ১. ফোল্ডার তৈরি করা (Nested Folder Hierarchy)
   */
  async createFolder(dto: CreateFolderDto) {
    const baseSlug = this.slugify(dto.name);
    let slug = baseSlug;
    let count = 1;

    while (await this.prisma.mediaFolder.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${count++}`;
    }

    return this.prisma.mediaFolder.create({
      data: {
        name: dto.name,
        slug,
        parentId: dto.parentId || null,
      },
      include: {
        parent: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * ২. সব ফোল্ডার দেখা
   */
  async getFolders(parentId?: string) {
    const where: any = {};
    if (parentId === 'root') {
      where.parentId = null;
    } else if (parentId) {
      where.parentId = parentId;
    }

    return this.prisma.mediaFolder.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        children: { select: { id: true, name: true, slug: true } },
        _count: { select: { files: true, children: true } },
      },
    });
  }

  /**
   * ৩. ফোল্ডার রিনেম বা আপডেট
   */
  async updateFolder(id: string, dto: UpdateFolderDto) {
    const folder = await this.prisma.mediaFolder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('Folder not found');

    return this.prisma.mediaFolder.update({
      where: { id },
      data: { name: dto.name },
    });
  }

  /**
   * ৪. ফোল্ডার ডিলিট করা
   */
  async deleteFolder(id: string) {
    const folder = await this.prisma.mediaFolder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('Folder not found');

    await this.prisma.mediaFolder.delete({ where: { id } });
    return { success: true, message: 'Folder deleted successfully' };
  }

  /**
   * ৫. ফোল্ডার খোঁজা বা না থাকলে তৈরি করা (যেমন: Product Images)
   */
  async getOrCreateFolder(name: string) {
    const slug = this.slugify(name);
    let folder = await this.prisma.mediaFolder.findFirst({
      where: {
        OR: [{ slug }, { name: { equals: name, mode: 'insensitive' } }],
      },
    });

    if (!folder) {
      folder = await this.prisma.mediaFolder.create({
        data: {
          name,
          slug,
        },
      });
    }

    return folder;
  }

  /**
   * ৬. ফাইল আপলোড ও ডাটাবেসে সংরক্ষণ
   */
  async saveUploadedFile(params: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    folderId?: string;
    uploadedBy?: string;
    altText?: string;
  }) {
    const { buffer, originalName, mimeType, folderId, uploadedBy, altText } = params;

    const ext = path.extname(originalName) || '.jpg';
    const randomHex = crypto.randomBytes(12).toString('hex');
    const fileName = `${Date.now()}-${randomHex}${ext.toLowerCase()}`;
    const filePath = path.join(this.uploadDir, fileName);

    // ডিস্কে ফাইল সেভ করা
    await fs.promises.writeFile(filePath, buffer);

    const fileSizeKb = Math.ceil(buffer.length / 1024);
    const cdnUrl = process.env.CDN_URL || process.env.MEDIA_CDN_URL;
    const appUrl = cdnUrl || process.env.APP_URL;
    const fileUrl = appUrl ? `${appUrl.replace(/\/+$/, '')}/uploads/${fileName}` : `/uploads/${fileName}`;

    return this.prisma.mediaFile.create({
      data: {
        fileName,
        originalName,
        fileUrl,
        storageProvider: cdnUrl ? 'cdn' : 'local',
        mimeType,
        fileSizeKb,
        folderId: folderId || null,
        uploadedBy: uploadedBy || null,
        altText: altText || originalName.replace(ext, ''),
      },
      include: {
        folder: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  /**
   * ৭. বাহ্যিক URL থেকে ছবি ডাউনলোড ও মিডিয়া লাইব্রেরিতে সংরক্ষণ (Auto-Ingest)
   */
  async importFromUrl(params: {
    imageUrl: string;
    folderId?: string;
    altText?: string;
    uploadedBy?: string;
  }) {
    let { imageUrl, folderId, altText, uploadedBy } = params;
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new BadRequestException('Valid image URL is required');
    }

    // Protocol-relative URL ফিক্স (//img.alicdn.com -> https://img.alicdn.com)
    if (imageUrl.startsWith('//')) {
      imageUrl = `https:${imageUrl}`;
    }

    // লোকাল বা সিডিএন ইউআরএল হলে রি-ডাউনলোড করার প্রয়োজন নেই
    const cdnUrl = process.env.CDN_URL || process.env.MEDIA_CDN_URL;
    const appUrl = process.env.APP_URL || 'http://localhost:5001';
    if (imageUrl.includes('/uploads/') || imageUrl.startsWith(appUrl) || (cdnUrl && imageUrl.startsWith(cdnUrl))) {
      const existing = await this.prisma.mediaFile.findFirst({
        where: { fileUrl: imageUrl },
      });
      if (existing) return existing;
    }

    // ফোল্ডার আইডি না থাকলে ডিফল্ট 'Product Images' ফোল্ডারে যাবে
    if (!folderId) {
      const productFolder = await this.getOrCreateFolder('Product Images');
      folderId = productFolder.id;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

      const response = await fetch(imageUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch image: HTTP ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      let mimeType = response.headers.get('content-type') || 'image/jpeg';
      if (mimeType.includes(';')) {
        mimeType = mimeType.split(';')[0].trim();
      }

      // ফাইল এক্সটেনশন ডিটেকশন
      let ext = '.jpg';
      if (mimeType.includes('png')) ext = '.png';
      else if (mimeType.includes('webp')) ext = '.webp';
      else if (mimeType.includes('gif')) ext = '.gif';
      else if (mimeType.includes('svg')) ext = '.svg';
      else if (mimeType.includes('avif')) ext = '.avif';
      else {
        try {
          const parsedPath = new URL(imageUrl).pathname;
          const parsedExt = path.extname(parsedPath);
          if (parsedExt && parsedExt.length <= 5) ext = parsedExt.toLowerCase();
        } catch {
          ext = '.jpg';
        }
      }

      let originalName = 'imported-product-image' + ext;
      try {
        const parsedPath = new URL(imageUrl).pathname;
        const base = path.basename(parsedPath);
        if (base && base.length > 2) {
          originalName = base.includes('.') ? base : `${base}${ext}`;
        }
      } catch {
        originalName = `imported-${Date.now()}${ext}`;
      }

      return await this.saveUploadedFile({
        buffer,
        originalName,
        mimeType,
        folderId,
        altText: altText || 'Product Image',
        uploadedBy: uploadedBy || 'Auto Ingest',
      });
    } catch (err: any) {
      throw new BadRequestException(`Image import failed from "${imageUrl}": ${err.message}`);
    }
  }

  /**
   * ৬. সব ফাইল ফিল্টার ও পেজিনেশন সহ আনা
   */
  async getFiles(query: MediaQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 24));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.folderId) {
      where.folderId = query.folderId === 'root' ? null : query.folderId;
    }

    if (query.mimeType) {
      where.mimeType = { startsWith: query.mimeType };
    }

    if (query.search) {
      where.OR = [
        { originalName: { contains: query.search, mode: 'insensitive' } },
        { fileName: { contains: query.search, mode: 'insensitive' } },
        { altText: { contains: query.search, mode: 'insensitive' } },
        { tags: { has: query.search.toLowerCase() } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.mediaFile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          folder: { select: { id: true, name: true } },
        },
      }),
      this.prisma.mediaFile.count({ where }),
    ]);

    return {
      success: true,
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * ৭. সিঙ্গেল ফাইল ডিটেইলস
   */
  async getFileById(id: string) {
    const file = await this.prisma.mediaFile.findUnique({
      where: { id },
      include: {
        folder: true,
      },
    });
    if (!file) throw new NotFoundException('File not found');
    return file;
  }

  /**
   * ৮. ফাইল মেটাডাটা আপডেট (Alt text, Caption, Tags, Move to Folder)
   */
  async updateFile(id: string, dto: UpdateFileDto) {
    const file = await this.prisma.mediaFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('File not found');

    return this.prisma.mediaFile.update({
      where: { id },
      data: {
        altText: dto.altText,
        caption: dto.caption,
        description: dto.description,
        tags: dto.tags,
        folderId: dto.folderId !== undefined ? dto.folderId : file.folderId,
      },
    });
  }

  /**
   * ৯. ফাইল পার্মানেন্ট ডিলিট করা
   */
  async deleteFile(id: string) {
    const file = await this.prisma.mediaFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('File not found');

    // ডিস্ক থেকে রিমুভ
    const localPath = path.join(this.uploadDir, file.fileName);
    if (fs.existsSync(localPath)) {
      try {
        await fs.promises.unlink(localPath);
      } catch (e) {
        // Log warning but continue deleting DB record
      }
    }

    await this.prisma.mediaFile.delete({ where: { id } });
    return { success: true, message: 'File deleted successfully' };
  }

  /**
   * ১০. মিডিয়া লাইব্রেরি পরিসংখ্যান (Storage & Files Stats)
   */
  async getStats() {
    const [totalFiles, totalFolders, aggregations] = await Promise.all([
      this.prisma.mediaFile.count(),
      this.prisma.mediaFolder.count(),
      this.prisma.mediaFile.aggregate({
        _sum: { fileSizeKb: true },
      }),
    ]);

    const totalSizeKb = aggregations._sum.fileSizeKb || 0;
    const totalSizeMb = (totalSizeKb / 1024).toFixed(2);

    return {
      success: true,
      totalFiles,
      totalFolders,
      totalSizeKb,
      totalSizeMb: `${totalSizeMb} MB`,
    };
  }
}
