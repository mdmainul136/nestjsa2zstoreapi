import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { CreateFolderDto, UpdateFolderDto, UpdateFileDto, MediaQueryDto, ImportUrlDto } from './dto/media.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Media Library')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * ১. ফাইল আপলোড (Images, Videos, PDFs): POST /media/upload
   */
  @ApiOperation({ summary: 'মিডিয়া লাইব্রেরিতে ফাইল আপলোড করা' })
  @ApiConsumes('multipart/form-data')
  @Post('upload')
  async uploadFile(@Req() req: any, @CurrentUser() user: any) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Multipart form-data expected');
    }

    const data = await req.file();
    if (!data) {
      throw new BadRequestException('No file found in request');
    }

    const buffer = await data.toBuffer();
    const originalName = data.filename || 'upload.bin';
    const mimeType = data.mimetype || 'application/octet-stream';
    const folderId = data.fields?.folderId?.value;
    const altText = data.fields?.altText?.value;

    return this.mediaService.saveUploadedFile({
      buffer,
      originalName,
      mimeType,
      folderId,
      altText,
      uploadedBy: user?.name || user?.email || 'Admin',
    });
  }

  /**
   * ২. বাহ্যিক URL থেকে ছবি মিডিয়া লাইব্রেরিতে সংরক্ষণ: POST /media/import-url
   */
  @ApiOperation({ summary: 'বাহ্যিক URL থেকে ছবি মিডিয়া লাইব্রেরিতে ইমপোর্ট করা' })
  @Post('import-url')
  async importFromUrl(@Body() dto: ImportUrlDto, @CurrentUser() user: any) {
    return this.mediaService.importFromUrl({
      imageUrl: dto.url,
      folderId: dto.folderId,
      altText: dto.altText,
      uploadedBy: user?.name || user?.email || 'Admin Import',
    });
  }

  /**
   * ২. সব ফাইলের তালিকা (ফিল্টার ও পেজিনেশন সহ): GET /media/files
   */
  @ApiOperation({ summary: 'সব ফাইলের তালিকা দেখা' })
  @Get('files')
  async getFiles(@Query() query: MediaQueryDto) {
    return this.mediaService.getFiles(query);
  }

  /**
   * ৩. নির্দিষ্ট ফাইলের ডিটেইলস: GET /media/files/:id
   */
  @ApiOperation({ summary: 'নির্দিষ্ট ফাইলের তথ্য দেখা' })
  @Get('files/:id')
  async getFileById(@Param('id') id: string) {
    return this.mediaService.getFileById(id);
  }

  /**
   * ৪. ফাইল মেটাডাটা আপডেট (Alt text, Caption, Tags): PATCH /media/files/:id
   */
  @ApiOperation({ summary: 'ফাইল মেটাডাটা আপডেট করা' })
  @Patch('files/:id')
  async updateFile(@Param('id') id: string, @Body() dto: UpdateFileDto) {
    return this.mediaService.updateFile(id, dto);
  }

  /**
   * ৫. ফাইল ডিলিট করা: DELETE /media/files/:id
   */
  @ApiOperation({ summary: 'ফাইল চিরতরে মুছে ফেলা' })
  @Delete('files/:id')
  async deleteFile(@Param('id') id: string) {
    return this.mediaService.deleteFile(id);
  }

  /**
   * ৬. ফোল্ডার তৈরি: POST /media/folders
   */
  @ApiOperation({ summary: 'নতুন মিডিয়া ফোল্ডার তৈরি করা' })
  @Post('folders')
  async createFolder(@Body() dto: CreateFolderDto) {
    return this.mediaService.createFolder(dto);
  }

  /**
   * ৭. সব ফোল্ডারের তালিকা: GET /media/folders
   */
  @ApiOperation({ summary: 'সব ফোল্ডারের তালিকা দেখা' })
  @Get('folders')
  async getFolders(@Query('parentId') parentId?: string) {
    return this.mediaService.getFolders(parentId);
  }

  /**
   * ৮. ফোল্ডার রিনেম: PATCH /media/folders/:id
   */
  @ApiOperation({ summary: 'ফোল্ডার রিনেম বা আপডেট করা' })
  @Patch('folders/:id')
  async updateFolder(@Param('id') id: string, @Body() dto: UpdateFolderDto) {
    return this.mediaService.updateFolder(id, dto);
  }

  /**
   * ৯. ফোল্ডার ডিলিট: DELETE /media/folders/:id
   */
  @ApiOperation({ summary: 'ফোল্ডার মুছে ফেলা' })
  @Delete('folders/:id')
  async deleteFolder(@Param('id') id: string) {
    return this.mediaService.deleteFolder(id);
  }

  /**
   * ১০. মিডিয়া লাইব্রেরি পরিসংখ্যান: GET /media/stats
   */
  @ApiOperation({ summary: 'মিডিয়া স্টোরেজ ব্যবহারের পরিসংখ্যান' })
  @Get('stats')
  async getStats() {
    return this.mediaService.getStats();
  }
}
