import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePurchaseOrderDto, BarcodeScanDto } from './dto/operations.dto';

@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────
  // ─── 1. WMS DASHBOARD ANALYTICS & STATS ──────────────────────
  // ─────────────────────────────────────────────────────────────
  async getDashboardStats() {
    const [
      totalParcels,
      awaiting,
      received,
      qcPass,
      repacked,
      dispatched,
      inTransit,
      customsHold,
      customsCleared,
      totalWarehouses,
      totalCarriers,
      activeCarriers,
      totalManifests,
      totalLocations,
      totalMaterials,
    ] = await Promise.all([
      this.prisma.parcel.count(),
      this.prisma.parcel.count({ where: { status: 'awaiting' } }),
      this.prisma.parcel.count({ where: { status: 'received' } }),
      this.prisma.parcel.count({ where: { status: 'qc_pass' } }),
      this.prisma.parcel.count({ where: { status: 'repacked' } }),
      this.prisma.parcel.count({ where: { status: 'dispatched' } }),
      this.prisma.parcel.count({ where: { status: 'in_transit' } }),
      this.prisma.parcel.count({ where: { status: 'customs_hold' } }),
      this.prisma.parcel.count({ where: { status: 'customs_cleared' } }),
      this.prisma.consolidatorWarehouse.count(),
      this.prisma.shippingCarrier.count(),
      this.prisma.shippingCarrier.count({ where: { isActive: true } }),
      this.prisma.cargoManifest.count(),
      this.prisma.warehouseLocation.count(),
      this.prisma.packagingMaterial.count(),
    ]);

    return {
      totalParcels,
      awaiting,
      received,
      qcPass,
      repacked,
      dispatched,
      inTransit,
      customsHold,
      customsCleared,
      readyForDispatch: qcPass + repacked,
      totalWarehouses,
      totalCarriers,
      activeCarriers,
      totalManifests,
      totalLocations,
      totalMaterials,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 2. INBOUND & QC PARCEL OPERATIONS ───────────────────────
  // ─────────────────────────────────────────────────────────────
  async getParcels(query?: { status?: string; warehouseId?: string; search?: string }) {
    const where: any = {};
    if (query?.status && query.status !== 'ALL') {
      where.status = query.status;
    }
    if (query?.warehouseId && query.warehouseId !== 'ALL') {
      where.warehouseId = query.warehouseId;
    }
    if (query?.search) {
      const q = query.search.trim();
      where.OR = [
        { supplierTracking: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { supplierName: { contains: q, mode: 'insensitive' } },
        { id: { contains: q } },
      ];
    }

    return this.prisma.parcel.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        warehouse: { select: { id: true, name: true, code: true, countryCode: true } },
        manifest: { select: { id: true, manifestNumber: true, carrierName: true, status: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            customerPhone: true,
            customerEmail: true,
            shippingCity: true,
            status: true,
            totalAmount: true,
            sourceName: true,
          },
        },
      },
    });
  }

  async getParcelById(id: string) {
    const parcel = await this.prisma.parcel.findUnique({
      where: { id },
      include: {
        warehouse: true,
        manifest: true,
        order: true,
        scanLogs: { orderBy: { scannedAt: 'desc' }, take: 20 },
      },
    });
    if (!parcel) throw new NotFoundException(`Parcel not found: ${id}`);
    return parcel;
  }

  async createParcel(data: {
    warehouseId: string;
    orderId?: string;
    supplierName?: string;
    supplierTracking?: string;
    weightKg?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    declaredValueUsd?: number;
    description?: string;
    status?: string;
    customerEmail?: string;
  }) {
    const tracking = data.supplierTracking ? data.supplierTracking.trim() : `PRC-${Date.now().toString().slice(-6)}`;

    let customerEmail = data.customerEmail || null;
    let description = data.description || null;
    let supplierName = data.supplierName || 'amazon';

    if (data.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: data.orderId },
        include: { items: true },
      });
      if (order) {
        if (!customerEmail) customerEmail = order.customerEmail;
        if (!description && Array.isArray(order.items) && order.items.length > 0) {
          description = order.items.map((it) => `${it.productTitle} (×${it.quantity})`).join(', ');
        }
        if (!data.supplierName && order.sourceName) {
          supplierName = order.sourceName;
        }

        // Add WMS tracking timeline event to order
        const history = Array.isArray(order.trackingHistory) ? (order.trackingHistory as any[]) : [];
        history.push({
          status: 'WAREHOUSE_RECEIVED',
          title: 'ওয়্যারহাউসে পণ্য গ্রহণ করা হয়েছে',
          description: `আপনার পার্সেলটি ওয়্যারহাউস হাবে সফলভাবে রিসিভ করা হয়েছে (Tracking: ${tracking})।`,
          timestamp: new Date().toISOString(),
        });

        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            supplierTrackingNumber: order.supplierTrackingNumber || tracking,
            warehouseId: order.warehouseId || data.warehouseId,
            trackingStatus: 'Received at Origin Warehouse',
            trackingHistory: history,
          },
        }).catch(() => null);
      }
    }

    const parcel = await this.prisma.parcel.create({
      data: {
        warehouseId: data.warehouseId,
        orderId: data.orderId || null,
        supplierName,
        supplierTracking: tracking,
        weightKg: data.weightKg !== undefined ? Number(data.weightKg) : 0.85,
        lengthCm: data.lengthCm !== undefined ? Number(data.lengthCm) : 24,
        widthCm: data.widthCm !== undefined ? Number(data.widthCm) : 20,
        heightCm: data.heightCm !== undefined ? Number(data.heightCm) : 10,
        declaredValueUsd: data.declaredValueUsd !== undefined ? Number(data.declaredValueUsd) : 0,
        description,
        status: data.status || 'received',
        customerEmail,
        receivedAt: new Date(),
      },
      include: {
        warehouse: true,
        order: true,
      },
    });

    // Auto-create Inbound Scan log
    await this.prisma.barcodeScanLog.create({
      data: {
        warehouseId: data.warehouseId,
        scannedBarcode: tracking,
        parcelId: parcel.id,
        action: 'INBOUND_RECEIVE',
        scannedByStaff: 'Inbound Receiver',
        notes: `Initial inbound registration for ${supplierName} (Order #${data.orderId || 'Direct'})`,
      },
    }).catch(() => null);

    return parcel;
  }

  async updateParcel(id: string, data: any) {
    const existing = await this.prisma.parcel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Parcel not found: ${id}`);

    const payload: any = {
      ...(data.orderId !== undefined && { orderId: data.orderId || null }),
      ...(data.customerEmail !== undefined && { customerEmail: data.customerEmail || null }),
      ...(data.supplierName && { supplierName: data.supplierName }),
      ...(data.supplierTracking && { supplierTracking: data.supplierTracking }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.weightKg !== undefined && { weightKg: Number(data.weightKg) }),
      ...(data.lengthCm !== undefined && { lengthCm: Number(data.lengthCm) }),
      ...(data.widthCm !== undefined && { widthCm: Number(data.widthCm) }),
      ...(data.heightCm !== undefined && { heightCm: Number(data.heightCm) }),
      ...(data.declaredValueUsd !== undefined && { declaredValueUsd: Number(data.declaredValueUsd) }),
      ...(data.status && { status: data.status }),
      ...(data.warehouseId && { warehouseId: data.warehouseId }),
      ...(data.dispatchCarrier !== undefined && { dispatchCarrier: data.dispatchCarrier }),
      ...(data.dispatchTracking !== undefined && { dispatchTracking: data.dispatchTracking }),
      ...(data.dispatchedAt !== undefined && { dispatchedAt: data.dispatchedAt ? new Date(data.dispatchedAt) : new Date() }),
      ...(data.dispatchedBy !== undefined && { dispatchedBy: data.dispatchedBy }),
    };

    const updated = await this.prisma.parcel.update({
      where: { id },
      data: payload,
      include: {
        warehouse: true,
        order: true,
      },
    });

    // If parcel is linked to an order, sync order tracking & status
    if (updated.orderId && data.status) {
      let orderTrackingStatus = 'In Transit';
      let orderStatus: any = undefined;

      if (data.status === 'received') {
        orderTrackingStatus = 'Received at Overseas Hub';
        orderStatus = 'PROCESSING_AT_WAREHOUSE';
      } else if (data.status === 'in_transit') {
        orderTrackingStatus = 'In International Flight to Dhaka';
        orderStatus = 'SHIPPED_TO_COUNTRY';
      } else if (data.status === 'dhaka_received' || data.status === 'customs_cleared') {
        orderTrackingStatus = 'Arrived at Dhaka Central Hub (Outbound Received)';
        orderStatus = 'CUSTOMS_CLEARANCE';
      } else if (data.status === 'dispatched') {
        orderTrackingStatus = `Handed over to ${data.dispatchCarrier || 'Local Courier'} (Tracking: ${data.dispatchTracking || ''})`;
        orderStatus = 'OUT_FOR_DELIVERY';
      } else if (data.status === 'delivered') {
        orderTrackingStatus = 'Delivered to Customer';
        orderStatus = 'DELIVERED';
      }

      await this.prisma.order.update({
        where: { id: updated.orderId },
        data: {
          trackingStatus: orderTrackingStatus,
          ...(orderStatus && { status: orderStatus }),
          ...(data.dispatchTracking && { localDeliveryTracking: data.dispatchTracking }),
          ...(data.dispatchCarrier && { localDeliveryCourier: data.dispatchCarrier }),
        },
      }).catch(() => null);
    }

    return updated;
  }

  async qcParcel(
    id: string,
    data: {
      qcPassed: boolean;
      qcNotes?: string;
      weightKg?: number;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      photoUrls?: string[];
    },
    staffName: string = 'WMS QC Staff',
  ) {
    const parcel = await this.prisma.parcel.findUnique({ where: { id } });
    if (!parcel) throw new NotFoundException(`Parcel not found: ${id}`);

    const isPass = Boolean(data.qcPassed);
    const updated = await this.prisma.parcel.update({
      where: { id },
      data: {
        qcDone: true,
        qcPassed: isPass,
        qcBy: staffName,
        qcAt: new Date(),
        qcNotes: data.qcNotes || (isPass ? 'Quality inspection passed. All items verified against order.' : 'Quality check failed / Damage noted.'),
        status: isPass ? 'qc_pass' : 'qc_fail',
        ...(data.photoUrls && { photoUrls: data.photoUrls }),
        ...(data.weightKg !== undefined && { weightKg: Number(data.weightKg) }),
        ...(data.lengthCm !== undefined && { lengthCm: Number(data.lengthCm) }),
        ...(data.widthCm !== undefined && { widthCm: Number(data.widthCm) }),
        ...(data.heightCm !== undefined && { heightCm: Number(data.heightCm) }),
      },
    });

    await this.prisma.barcodeScanLog.create({
      data: {
        warehouseId: parcel.warehouseId,
        scannedBarcode: parcel.supplierTracking || parcel.id,
        parcelId: parcel.id,
        action: 'QC_INSPECTION',
        scannedByStaff: staffName,
        notes: `QC Result: ${isPass ? 'PASSED' : 'FAILED'}. Weight: ${updated.weightKg}kg. Notes: ${data.qcNotes || 'N/A'}`,
      },
    }).catch(() => null);

    return updated;
  }

  async repackParcel(
    id: string,
    data: {
      repackedWeightKg: number;
      packagingMaterialId?: string;
      notes?: string;
    },
    staffName: string = 'WMS Repack Staff',
  ) {
    const parcel = await this.prisma.parcel.findUnique({ where: { id } });
    if (!parcel) throw new NotFoundException(`Parcel not found: ${id}`);

    const repackedWeight = Number(data.repackedWeightKg);
    const weightSaved = (parcel.weightKg || 0) > repackedWeight ? (parcel.weightKg! - repackedWeight).toFixed(2) : '0';

    const updated = await this.prisma.parcel.update({
      where: { id },
      data: {
        isRepacked: true,
        repackedWeightKg: repackedWeight,
        weightKg: repackedWeight, // Update chargeable weight
        status: 'qc_pass', // Ready for manifest
      },
    });

    // Deduct packaging material stock if specified
    if (data.packagingMaterialId) {
      await this.prisma.packagingMaterial.update({
        where: { id: data.packagingMaterialId },
        data: { stockQty: { decrement: 1 } },
      }).catch(() => null);
    }

    await this.prisma.barcodeScanLog.create({
      data: {
        warehouseId: parcel.warehouseId,
        scannedBarcode: parcel.supplierTracking || parcel.id,
        parcelId: parcel.id,
        action: 'REPACK_DISCARD',
        scannedByStaff: staffName,
        notes: `Repacked parcel. Original: ${parcel.weightKg}kg -> New: ${repackedWeight}kg. (Saved ~${weightSaved}kg freight weight). ${data.notes || ''}`,
      },
    }).catch(() => null);

    return updated;
  }

  async assignParcelBin(
    id: string,
    data: { locationBarcode: string },
    staffName: string = 'WMS Staff',
  ) {
    const parcel = await this.prisma.parcel.findUnique({ where: { id } });
    if (!parcel) throw new NotFoundException(`Parcel not found: ${id}`);

    // Mark location as occupied
    await this.prisma.warehouseLocation.updateMany({
      where: { barcode: data.locationBarcode },
      data: { isOccupied: true },
    }).catch(() => null);

    await this.prisma.barcodeScanLog.create({
      data: {
        warehouseId: parcel.warehouseId,
        scannedBarcode: parcel.supplierTracking || parcel.id,
        parcelId: parcel.id,
        action: 'BIN_ALLOCATION',
        locationCode: data.locationBarcode,
        scannedByStaff: staffName,
        notes: `Allocated to Bin Location: ${data.locationBarcode}`,
      },
    });

    return { success: true, parcelId: id, locationBarcode: data.locationBarcode };
  }

  async deleteParcel(id: string) {
    const existing = await this.prisma.parcel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Parcel not found: ${id}`);
    return this.prisma.parcel.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 3. HANDHELD ZEBRA BARCODE SCANNER ENGINE ────────────────
  // ─────────────────────────────────────────────────────────────
  async processBarcodeScan(
    dto: BarcodeScanDto,
    staffName: string = 'WMS Staff',
  ) {
    this.logger.log(`🔫 Barcode Scanned: [${dto.action}] Barcode: ${dto.barcode}`);

    // 1. Try to find existing parcel by supplierTracking or id
    let parcel = await this.prisma.parcel.findFirst({
      where: {
        OR: [
          { supplierTracking: { equals: dto.barcode.trim(), mode: 'insensitive' } },
          { id: dto.barcode.trim() },
        ],
      },
    });

    // If inbound receive and parcel doesn't exist, auto-create it!
    if (!parcel && dto.action === 'INBOUND_RECEIVE') {
      parcel = await this.prisma.parcel.create({
        data: {
          warehouseId: dto.warehouseId,
          supplierName: 'amazon',
          supplierTracking: dto.barcode.trim(),
          status: 'received',
          weightKg: 0.5,
          receivedAt: new Date(),
          description: `Auto-registered from Barcode Scan: ${dto.barcode.trim()}`,
        },
      });
    }

    // 2. Log the scan event
    const log = await this.prisma.barcodeScanLog.create({
      data: {
        warehouseId: dto.warehouseId,
        scannedBarcode: dto.barcode.trim(),
        parcelId: parcel?.id || dto.parcelId || null,
        action: dto.action as any,
        scannedByStaff: staffName,
        locationCode: dto.locationCode || null,
        notes: dto.notes || null,
      },
    });

    // 3. Update parcel status based on scan action
    if (parcel) {
      if (dto.action === 'INBOUND_RECEIVE') {
        await this.prisma.parcel.update({
          where: { id: parcel.id },
          data: { status: 'received', receivedAt: new Date() },
        });
      } else if (dto.action === 'BIN_ALLOCATION') {
        if (dto.locationCode) {
          await this.prisma.warehouseLocation.updateMany({
            where: { barcode: dto.locationCode },
            data: { isOccupied: true },
          }).catch(() => null);
        }
      } else if (dto.action === 'QC_INSPECTION') {
        await this.prisma.parcel.update({
          where: { id: parcel.id },
          data: {
            status: 'qc_pass',
            qcDone: true,
            qcPassed: true,
            qcBy: staffName,
            qcAt: new Date(),
            photoUrls: dto.photoUrls || [],
          },
        });
      } else if (dto.action === 'REPACK_DISCARD') {
        await this.prisma.parcel.update({
          where: { id: parcel.id },
          data: { isRepacked: true, status: 'qc_pass' },
        });
      } else if (dto.action === 'DISPATCH_FLIGHT') {
        await this.prisma.parcel.update({
          where: { id: parcel.id },
          data: { status: 'in_transit' },
        });
        if (parcel.orderId) {
          await this.prisma.order.update({
            where: { id: parcel.orderId },
            data: {
              trackingStatus: 'In International Flight to Dhaka',
              status: 'SHIPPED_TO_COUNTRY',
            },
          }).catch(() => null);
        }
      } else if (dto.action === 'OUTBOUND_DHAKA_RECEIVE' || (dto.action as string) === 'DHAKA_RECEIVE') {
        await this.prisma.parcel.update({
          where: { id: parcel.id },
          data: { status: 'dhaka_received' },
        });
        if (parcel.orderId) {
          await this.prisma.order.update({
            where: { id: parcel.orderId },
            data: {
              trackingStatus: 'Arrived at Dhaka Central Hub (Outbound Received)',
              status: 'CUSTOMS_CLEARANCE',
            },
          }).catch(() => null);
        }
      }
    }

    return {
      success: true,
      action: dto.action,
      barcode: dto.barcode,
      parcelId: parcel?.id,
      parcelStatus: parcel?.status,
      timestamp: log.scannedAt,
      message: `Barcode scan processed: ${dto.action} on "${dto.barcode}"`,
    };
  }

  async getScanLogs(limit: number = 30) {
    return this.prisma.barcodeScanLog.findMany({
      orderBy: { scannedAt: 'desc' },
      take: limit,
      include: {
        parcel: { select: { id: true, supplierTracking: true, description: true, status: true } },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 4. WAREHOUSE LOCATIONS & RACK/BIN ALLOCATION ────────────
  // ─────────────────────────────────────────────────────────────
  async getWarehouseLocations(warehouseId?: string) {
    const where = warehouseId && warehouseId !== 'ALL' ? { warehouseId } : {};
    return this.prisma.warehouseLocation.findMany({
      where,
      orderBy: [{ aisle: 'asc' }, { rack: 'asc' }, { shelf: 'asc' }, { bin: 'asc' }],
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async createWarehouseLocation(data: {
    warehouseId: string;
    aisle: string;
    rack: string;
    shelf: string;
    bin: string;
  }) {
    const barcode = `LOC-${data.aisle.replace(/\s+/g, '')}-${data.rack.replace(/\s+/g, '')}-${data.shelf.replace(/\s+/g, '')}-${data.bin.replace(/\s+/g, '')}`.toUpperCase();

    return this.prisma.warehouseLocation.upsert({
      where: { barcode },
      update: {
        warehouseId: data.warehouseId,
        aisle: data.aisle,
        rack: data.rack,
        shelf: data.shelf,
        bin: data.bin,
      },
      create: {
        warehouseId: data.warehouseId,
        aisle: data.aisle,
        rack: data.rack,
        shelf: data.shelf,
        bin: data.bin,
        barcode,
        isOccupied: false,
      },
    });
  }

  async bulkGenerateWarehouseLocations(data: {
    warehouseId: string;
    aisleCount?: number;
    racksPerAisle?: number;
    shelvesPerRack?: number;
    binsPerShelf?: number;
  }) {
    const warehouse = await this.prisma.consolidatorWarehouse.findUnique({ where: { id: data.warehouseId } });
    if (!warehouse) throw new NotFoundException(`Warehouse not found: ${data.warehouseId}`);

    const aisleCount = data.aisleCount || 2;
    const racksCount = data.racksPerAisle || 2;
    const shelvesCount = data.shelvesPerRack || 3;
    const binsCount = data.binsPerShelf || 4;

    const locationsData: any[] = [];
    for (let a = 1; a <= aisleCount; a++) {
      const aisleStr = `A0${a}`;
      for (let r = 0; r < racksCount; r++) {
        const rackStr = `R${String.fromCharCode(65 + r)}`; // RA, RB, RC
        for (let s = 1; s <= shelvesCount; s++) {
          const shelfStr = `S0${s}`;
          for (let b = 1; b <= binsCount; b++) {
            const binStr = `B0${b}`;
            const barcode = `LOC-${warehouse.countryCode || 'US'}-${aisleStr}-${rackStr}-${shelfStr}-${binStr}`;
            locationsData.push({
              warehouseId: warehouse.id,
              aisle: `Aisle ${a}`,
              rack: `Rack ${String.fromCharCode(65 + r)}`,
              shelf: `Shelf ${s}`,
              bin: `Bin ${b}`,
              barcode,
              isOccupied: false,
            });
          }
        }
      }
    }

    // Upsert each location safely
    let createdCount = 0;
    for (const loc of locationsData) {
      const exists = await this.prisma.warehouseLocation.findUnique({ where: { barcode: loc.barcode } });
      if (!exists) {
        await this.prisma.warehouseLocation.create({ data: loc });
        createdCount++;
      }
    }

    return {
      success: true,
      totalGenerated: locationsData.length,
      newlyCreated: createdCount,
      warehouseName: warehouse.name,
    };
  }

  async deleteWarehouseLocation(id: string) {
    const existing = await this.prisma.warehouseLocation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Location not found: ${id}`);
    return this.prisma.warehouseLocation.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 5. PACKAGING MATERIALS & SUPPLIES ───────────────────────
  // ─────────────────────────────────────────────────────────────
  async getPackagingMaterials() {
    return this.prisma.packagingMaterial.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async upsertPackagingMaterial(data: {
    id?: string;
    name: string;
    type: string;
    unitCostUsd: number;
    stockQty: number;
    weightGrams?: number;
  }) {
    const payload = {
      name: data.name.trim(),
      type: data.type.toUpperCase().trim(),
      unitCostUsd: Number(data.unitCostUsd),
      stockQty: Number(data.stockQty),
      weightGrams: data.weightGrams !== undefined ? Number(data.weightGrams) : 150.0,
    };

    if (data.id) {
      return this.prisma.packagingMaterial.update({
        where: { id: data.id },
        data: payload,
      });
    }

    return this.prisma.packagingMaterial.create({ data: payload });
  }

  async deletePackagingMaterial(id: string) {
    const existing = await this.prisma.packagingMaterial.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Packaging material not found: ${id}`);
    return this.prisma.packagingMaterial.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 6. WAREHOUSE HUBS & SCHEDULES ───────────────────────────
  // ─────────────────────────────────────────────────────────────
  autoGenerateShipmentNotice(params: {
    warehouseName: string;
    frequency?: string;
    days?: string[];
    cutoffTime?: string;
    nextShipmentDate?: Date | string | null;
    transitDaysMin?: number;
    transitDaysMax?: number;
  }): string {
    const daysStr = params.days && params.days.length > 0 ? params.days.join(', ') : 'Friday';
    const cutoff = params.cutoffTime || '17:00 EST';
    const minD = params.transitDaysMin || 5;
    const maxD = params.transitDaysMax || 8;
    const nextDateStr = params.nextShipmentDate
      ? new Date(params.nextShipmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null;

    if (nextDateStr) {
      return `Next scheduled cargo departure: ${daysStr} (${nextDateStr}) at ${cutoff}. Cut-off: 24h prior. Estimated delivery in Dhaka: ${minD}-${maxD} days.`;
    }
    return `Scheduled cargo departure: Every ${daysStr} at ${cutoff}. Estimated delivery in Dhaka: ${minD}-${maxD} days.`;
  }

  async getWarehouses() {
    const warehouses = await this.prisma.consolidatorWarehouse.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: { parcels: true, orders: true, manifests: true, locations: true },
        },
      },
    });

    const enriched = await Promise.all(
      warehouses.map(async (w) => {
        const [awaitingParcels, receivedParcels, qcPassParcels, dispatchedParcels] = await Promise.all([
          this.prisma.parcel.count({ where: { warehouseId: w.id, status: 'awaiting' } }),
          this.prisma.parcel.count({ where: { warehouseId: w.id, status: 'received' } }),
          this.prisma.parcel.count({ where: { warehouseId: w.id, status: 'qc_pass' } }),
          this.prisma.parcel.count({ where: { warehouseId: w.id, status: 'dispatched' } }),
        ]);

        return {
          ...w,
          stats: {
            awaitingParcels,
            receivedParcels,
            qcPassParcels,
            dispatchedParcels,
            readyForManifest: qcPassParcels,
          },
        };
      }),
    );

    return enriched;
  }

  async getWarehouseById(id: string) {
    const warehouse = await this.prisma.consolidatorWarehouse.findUnique({
      where: { id },
      include: {
        locations: { take: 50 },
        manifests: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: { parcels: true, orders: true, locations: true },
        },
      },
    });

    if (!warehouse) throw new NotFoundException(`Warehouse not found: ${id}`);
    return warehouse;
  }

  async upsertWarehouse(data: any) {
    const payload: any = {
      code: data.code.toUpperCase().trim(),
      name: data.name.trim(),
      countryCode: data.countryCode ? data.countryCode.toUpperCase() : 'US',
      city: data.city ? data.city.trim() : '',
      address: data.address ? data.address.trim() : '',
      postalCode: data.postalCode || null,
      phone: data.phone || null,
      email: data.email || null,
      repackingAvailable: data.repackingAvailable ?? true,
      consolidationAvailable: data.consolidationAvailable ?? true,
      photoCheckAvailable: data.photoCheckAvailable ?? true,
      qcAvailable: data.qcAvailable ?? true,
      shipmentFrequency: data.shipmentFrequency || 'Weekly (Tue, Fri)',
      shipmentDays: Array.isArray(data.shipmentDays) ? data.shipmentDays : ['Tuesday', 'Friday'],
      cutoffTime: data.cutoffTime || '17:00 EST',
      transitDaysMin: data.transitDaysMin !== undefined ? Number(data.transitDaysMin) : 5,
      transitDaysMax: data.transitDaysMax !== undefined ? Number(data.transitDaysMax) : 8,
      isActive: data.isActive ?? true,
    };

    if (data.nextShipmentDate && typeof data.nextShipmentDate === 'string' && data.nextShipmentDate.trim()) {
      payload.nextShipmentDate = new Date(data.nextShipmentDate);
    } else if (data.nextShipmentDate instanceof Date) {
      payload.nextShipmentDate = data.nextShipmentDate;
    }

    if (!data.shipmentNotice) {
      payload.shipmentNotice = this.autoGenerateShipmentNotice({
        warehouseName: payload.name,
        frequency: payload.shipmentFrequency,
        days: payload.shipmentDays,
        cutoffTime: payload.cutoffTime,
        nextShipmentDate: payload.nextShipmentDate,
        transitDaysMin: payload.transitDaysMin,
        transitDaysMax: payload.transitDaysMax,
      });
    } else {
      payload.shipmentNotice = data.shipmentNotice;
    }

    if (data.id) {
      return this.prisma.consolidatorWarehouse.update({
        where: { id: data.id },
        data: payload,
      });
    }

    return this.prisma.consolidatorWarehouse.upsert({
      where: { code: payload.code },
      update: payload,
      create: payload,
    });
  }

  async updateWarehouseSchedule(id: string, data: any) {
    const warehouse = await this.prisma.consolidatorWarehouse.findUnique({ where: { id } });
    if (!warehouse) throw new NotFoundException(`Warehouse not found: ${id}`);

    const nextShipmentDate = data.nextShipmentDate
      ? new Date(data.nextShipmentDate)
      : warehouse.nextShipmentDate;

    const shipmentDays =
      data.shipmentDays !== undefined
        ? Array.isArray(data.shipmentDays)
          ? data.shipmentDays
          : String(data.shipmentDays)
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean)
        : warehouse.shipmentDays;

    const cutoffTime = data.cutoffTime ?? warehouse.cutoffTime;
    const shipmentFrequency = data.shipmentFrequency ?? warehouse.shipmentFrequency;
    const transitDaysMin =
      data.transitDaysMin !== undefined ? Number(data.transitDaysMin) : warehouse.transitDaysMin;
    const transitDaysMax =
      data.transitDaysMax !== undefined ? Number(data.transitDaysMax) : warehouse.transitDaysMax;

    const shipmentNotice =
      data.shipmentNotice ||
      this.autoGenerateShipmentNotice({
        warehouseName: warehouse.name,
        frequency: shipmentFrequency,
        days: shipmentDays,
        cutoffTime,
        nextShipmentDate,
        transitDaysMin,
        transitDaysMax,
      });

    return this.prisma.consolidatorWarehouse.update({
      where: { id },
      data: {
        ...(data.shipmentFrequency && { shipmentFrequency: data.shipmentFrequency }),
        ...(data.shipmentDays !== undefined && { shipmentDays }),
        ...(data.cutoffTime && { cutoffTime: data.cutoffTime }),
        ...(nextShipmentDate && { nextShipmentDate }),
        shipmentNotice,
        ...(data.transitDaysMin !== undefined && { transitDaysMin }),
        ...(data.transitDaysMax !== undefined && { transitDaysMax }),
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 7. MULTI-CARRIER DIRECTORY ──────────────────────────────
  // ─────────────────────────────────────────────────────────────
  async getShippingCarriers(leg?: string) {
    // Check if table is empty or missing standard BD/freight carriers, auto-seed defaults
    const count = await this.prisma.shippingCarrier.count();
    if (count === 0) {
      await this.seedDefaultShippingCarriers();
    }

    const where: any = {};
    if (leg && leg !== 'ALL') {
      where.leg = leg.toUpperCase();
    }

    return this.prisma.shippingCarrier.findMany({
      where,
      orderBy: [{ leg: 'asc' }, { name: 'asc' }],
    });
  }

  async seedDefaultShippingCarriers() {
    // Clean up any legacy airline records
    await this.prisma.shippingCarrier.deleteMany({
      where: {
        code: { in: ['emirates', 'qatar_cargo', 'biman', 'aramex_cargo', 'skynet_bd', 'transworld_cargo', 'dhl_express'] },
      },
    });

    const defaultCarriers = [
      // ── BD Local Couriers ──
      {
        code: 'steadfast',
        name: 'Steadfast Courier (স্টেডফাস্ট)',
        leg: 'LOCAL_BD_COURIER',
        serviceType: 'CASH_ON_DELIVERY',
        baseDeliveryFeeBdt: 60,
        outsideDhakaFeeBdt: 120,
        codFeePercent: 1.0,
        trackingUrlTemplate: 'https://steadfast.com.bd/t/{tracking}',
        contactPhone: '+8809678-045045',
        contactEmail: 'support@steadfast.com.bd',
        notes: 'Default API integration for Bangladesh Nationwide Cash on Delivery (COD).',
        isActive: true,
      },
      {
        code: 'pathao',
        name: 'Pathao Courier (পাঠাও)',
        leg: 'LOCAL_BD_COURIER',
        serviceType: 'EXPRESS_SAME_DAY',
        baseDeliveryFeeBdt: 70,
        outsideDhakaFeeBdt: 130,
        codFeePercent: 1.0,
        trackingUrlTemplate: 'https://merchant.pathao.com/tracking?consignment_id={tracking}',
        contactPhone: '+8809610-003030',
        contactEmail: 'merchant.support@pathao.com',
        notes: 'Fast intra-city Dhaka same-day and nationwide door-to-door delivery.',
        isActive: true,
      },
      {
        code: 'redx',
        name: 'RedX Logistics (রেডএক্স)',
        leg: 'LOCAL_BD_COURIER',
        serviceType: 'CASH_ON_DELIVERY',
        baseDeliveryFeeBdt: 60,
        outsideDhakaFeeBdt: 110,
        codFeePercent: 1.0,
        trackingUrlTemplate: 'https://redx.com.bd/track-order?trackingId={tracking}',
        contactPhone: '+8809610-007339',
        contactEmail: 'support@redx.com.bd',
        notes: 'Nationwide door-to-door delivery with live OTP verification.',
        isActive: true,
      },
      {
        code: 'paperfly',
        name: 'Paperfly Logistics (পেপারফ্লাই)',
        leg: 'LOCAL_BD_COURIER',
        serviceType: 'DOORSTEP_DELIVERY',
        baseDeliveryFeeBdt: 65,
        outsideDhakaFeeBdt: 115,
        codFeePercent: 1.0,
        trackingUrlTemplate: 'https://paperfly.com.bd/track?tracking_number={tracking}',
        contactPhone: '+8809678-300400',
        contactEmail: 'support@paperfly.com.bd',
        notes: 'Deep nationwide doorstep delivery across all union parishads.',
        isActive: true,
      },
      {
        code: 'sundarban',
        name: 'Sundarban Courier Service (সুন্দরবন)',
        leg: 'LOCAL_BD_COURIER',
        serviceType: 'STANDARD_DELIVERY',
        baseDeliveryFeeBdt: 50,
        outsideDhakaFeeBdt: 100,
        codFeePercent: 0.0,
        trackingUrlTemplate: 'https://sundarbancourier.com/track/{tracking}',
        contactPhone: '+8802-9568770',
        notes: 'Branch to branch & parcel booking across 64 districts.',
        isActive: true,
      },
      {
        code: 'office_pickup',
        name: 'A2Z Office Self-Pickup (সেলফ পিকআপ)',
        leg: 'LOCAL_BD_COURIER',
        serviceType: 'OFFICE_PICKUP',
        baseDeliveryFeeBdt: 0,
        outsideDhakaFeeBdt: 0,
        codFeePercent: 0.0,
        notes: 'Customer directly collects order from A2Z Dhaka Central Hub (Banani / Uttara).',
        isActive: true,
      },

      // ── Origin Domestic Couriers ──
      {
        code: 'usps',
        name: 'US Postal Service (USPS)',
        leg: 'DOMESTIC_ORIGIN',
        serviceType: 'PRIORITY_MAIL',
        trackingUrlTemplate: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}',
        notes: 'US merchant delivery to A2Z JFK Consolidation Hub.',
        isActive: true,
      },
      {
        code: 'ups',
        name: 'United Parcel Service (UPS)',
        leg: 'DOMESTIC_ORIGIN',
        serviceType: 'GROUND_SHIPPING',
        trackingUrlTemplate: 'https://www.ups.com/track?tracknum={tracking}',
        notes: 'US domestic ground and 2nd-day air shipping.',
        isActive: true,
      },
      {
        code: 'fedex',
        name: 'FedEx Express & Ground',
        leg: 'DOMESTIC_ORIGIN',
        serviceType: 'GROUND_SHIPPING',
        trackingUrlTemplate: 'https://www.fedex.com/fedextrack/?trknbr={tracking}',
        notes: 'US domestic standard and overnight courier.',
        isActive: true,
      },
      {
        code: 'royal_mail',
        name: 'Royal Mail (UK)',
        leg: 'DOMESTIC_ORIGIN',
        serviceType: 'STANDARD_DELIVERY',
        trackingUrlTemplate: 'https://www.royalmail.com/track-your-item#/tracking-results/{tracking}',
        notes: 'UK domestic sellers to Heathrow Hub.',
        isActive: true,
      },
      {
        code: 'sf_express',
        name: 'SF Express (China)',
        leg: 'DOMESTIC_ORIGIN',
        serviceType: 'EXPRESS_COURIER',
        trackingUrlTemplate: 'https://www.sf-express.com/cn/en/dynamic_function/waybill/#search/bill-number/{tracking}',
        notes: 'China 1688/Taobao/Alibaba to Guangzhou hub.',
        isActive: true,
      },
    ];

    for (const c of defaultCarriers) {
      await this.prisma.shippingCarrier.upsert({
        where: { code: c.code },
        update: c,
        create: c,
      });
    }
  }

  async upsertShippingCarrier(data: any) {
    const payload = {
      code: data.code.toLowerCase().trim(),
      name: data.name.trim(),
      leg: data.leg,
      serviceType: data.serviceType,
      ratePerKgUsd: data.ratePerKgUsd !== undefined ? Number(data.ratePerKgUsd) : 0,
      baseDeliveryFeeBdt: data.baseDeliveryFeeBdt !== undefined ? Number(data.baseDeliveryFeeBdt) : 0,
      outsideDhakaFeeBdt: data.outsideDhakaFeeBdt !== undefined ? Number(data.outsideDhakaFeeBdt) : 0,
      codFeePercent: data.codFeePercent !== undefined ? Number(data.codFeePercent) : 0,
      trackingUrlTemplate: data.trackingUrlTemplate || null,
      contactPhone: data.contactPhone || null,
      contactEmail: data.contactEmail || null,
      accountNumber: data.accountNumber || null,
      apiEndpoint: data.apiEndpoint || null,
      apiKey: data.apiKey || null,
      notes: data.notes || null,
      isActive: data.isActive ?? true,
    };

    if (data.id) {
      return this.prisma.shippingCarrier.update({
        where: { id: data.id },
        data: payload,
      });
    }

    return this.prisma.shippingCarrier.upsert({
      where: { code: payload.code },
      update: payload,
      create: payload,
    });
  }

  async toggleCarrierStatus(id: string) {
    const carrier = await this.prisma.shippingCarrier.findUnique({ where: { id } });
    if (!carrier) throw new NotFoundException(`Carrier not found: ${id}`);

    return this.prisma.shippingCarrier.update({
      where: { id },
      data: { isActive: !carrier.isActive },
    });
  }

  async deleteWarehouse(id: string) {
    const existing = await this.prisma.consolidatorWarehouse.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(`Warehouse not found: ${id}`);

    return this.prisma.$transaction(async (tx) => {
      // 1. Unlink any orders referencing this warehouse
      await tx.order.updateMany({
        where: { warehouseId: id },
        data: { warehouseId: null },
      });

      // 2. Delete scan logs
      await tx.barcodeScanLog.deleteMany({
        where: { warehouseId: id },
      });

      // 3. Delete bin locations
      await tx.warehouseLocation.deleteMany({
        where: { warehouseId: id },
      });

      // 4. Delete parcels
      await tx.parcel.deleteMany({
        where: { warehouseId: id },
      });

      // 5. Delete flight manifests
      await tx.cargoManifest.deleteMany({
        where: { warehouseId: id },
      });

      // 6. Delete shipping rates if any
      await tx.shippingRate.deleteMany({
        where: { warehouseId: id },
      });

      // 7. Delete warehouse itself
      return tx.consolidatorWarehouse.delete({
        where: { id },
      });
    });
  }

  async deleteShippingCarrier(id: string) {
    const existing = await this.prisma.shippingCarrier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Carrier not found: ${id}`);
    return this.prisma.shippingCarrier.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 8. CARGO FLIGHT MANIFESTS (Leg 2 Air Freight) ───────────
  // ─────────────────────────────────────────────────────────────
  async getCargoManifests(warehouseId?: string, status?: string) {
    const where: any = {};
    if (warehouseId && warehouseId !== 'ALL') where.warehouseId = warehouseId;
    if (status && status !== 'ALL') where.status = status.toUpperCase();

    return this.prisma.cargoManifest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        warehouse: { select: { id: true, name: true, countryCode: true, code: true } },
        parcels: {
          select: {
            id: true,
            supplierTracking: true,
            description: true,
            weightKg: true,
            declaredValueUsd: true,
            status: true,
          },
        },
        _count: { select: { parcels: true } },
      },
    });
  }

  async getManifestById(id: string) {
    const manifest = await this.prisma.cargoManifest.findUnique({
      where: { id },
      include: {
        warehouse: true,
        parcels: true,
      },
    });
    if (!manifest) throw new NotFoundException(`Manifest not found: ${id}`);
    return manifest;
  }

  async createCargoManifest(data: any, staffName: string = 'WMS Ops') {
    const manifestNumber = `MNF-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

    const manifest = await this.prisma.cargoManifest.create({
      data: {
        manifestNumber,
        warehouseId: data.warehouseId,
        carrierName: data.carrierName || 'Emirates SkyCargo',
        carrierCode: data.carrierCode || null,
        masterAwb: data.masterAwb || null,
        flightNumber: data.flightNumber || null,
        originCountry: data.originCountry || 'US',
        destCountry: data.destCountry || 'BD',
        departureDate: data.departureDate ? new Date(data.departureDate) : null,
        estimatedArrivalDate: data.estimatedArrivalDate ? new Date(data.estimatedArrivalDate) : null,
        status: 'BOOKED',
        notes: data.notes || null,
      },
    });

    if (data.parcelIds && data.parcelIds.length > 0) {
      await this.prisma.parcel.updateMany({
        where: { id: { in: data.parcelIds } },
        data: {
          manifestId: manifest.id,
          status: 'dispatched',
          dispatchCarrier: data.carrierName,
          dispatchTracking: data.masterAwb || null,
          dispatchedAt: new Date(),
          dispatchedBy: staffName,
        },
      });

      const parcels = await this.prisma.parcel.findMany({
        where: { id: { in: data.parcelIds } },
        select: { weightKg: true, declaredValueUsd: true },
      });

      const totalWeight = parcels.reduce((sum, p) => sum + (p.weightKg || 0.2), 0);
      const totalValue = parcels.reduce((sum, p) => sum + (p.declaredValueUsd || 0), 0);

      await this.prisma.cargoManifest.update({
        where: { id: manifest.id },
        data: {
          totalParcelsCount: data.parcelIds.length,
          totalGrossWeightKg: Math.round(totalWeight * 100) / 100,
          totalDeclaredValueUsd: Math.round(totalValue),
        },
      });
    }

    return this.prisma.cargoManifest.findUnique({
      where: { id: manifest.id },
      include: {
        parcels: true,
        warehouse: true,
      },
    });
  }

  async updateCargoManifestStatus(id: string, status: string, notes?: string) {
    const manifest = await this.prisma.cargoManifest.findUnique({
      where: { id },
      include: { parcels: true },
    });
    if (!manifest) throw new NotFoundException(`Manifest not found: ${id}`);

    const updated = await this.prisma.cargoManifest.update({
      where: { id },
      data: {
        status: status.toUpperCase(),
        ...(notes && { notes }),
        ...(status.toUpperCase() === 'CLEARED' && { actualArrivalDate: new Date() }),
      },
    });

    let parcelStatus: string | null = null;
    if (status.toUpperCase() === 'DEPARTED' || status.toUpperCase() === 'IN_FLIGHT') {
      parcelStatus = 'in_transit';
    } else if (status.toUpperCase() === 'CUSTOMS_BD') {
      parcelStatus = 'customs_hold';
    } else if (status.toUpperCase() === 'CLEARED' || status.toUpperCase() === 'COMPLETED') {
      parcelStatus = 'customs_cleared';
    }

    if (parcelStatus && manifest.parcels.length > 0) {
      await this.prisma.parcel.updateMany({
        where: { manifestId: id },
        data: { status: parcelStatus },
      });
    }

    return updated;
  }

  async deleteCargoManifest(id: string) {
    const existing = await this.prisma.cargoManifest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Manifest not found: ${id}`);

    // Unassign parcels
    await this.prisma.parcel.updateMany({
      where: { manifestId: id },
      data: { manifestId: null, status: 'qc_pass' },
    });

    return this.prisma.cargoManifest.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 9. PROCUREMENT & SUPPLIER ACCOUNTS ──────────────────────
  // ─────────────────────────────────────────────────────────────
  async createPurchaseOrder(dto: CreatePurchaseOrderDto, staffId?: string) {
    const poNumber = `PO-${dto.supplierName.toUpperCase()}-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const po = await this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        orderId: dto.orderId || null,
        supplierName: dto.supplierName.toLowerCase(),
        supplierOrderId: dto.supplierOrderId,
        purchasedByStaffId: staffId || null,
        paymentCardLast4: dto.paymentCardLast4 || null,
        itemsCostUsd: dto.totalCostUsd,
        totalCostUsd: dto.totalCostUsd,
        trackingNumber: dto.trackingNumber || null,
        invoiceUrl: dto.invoiceUrl || null,
        notes: dto.notes || null,
        status: 'PURCHASED',
      },
    });

    if (dto.orderId) {
      await this.prisma.order.update({
        where: { id: dto.orderId },
        data: {
          status: 'MARKETPLACE_ORDERED',
          sourceOrderNumber: dto.supplierOrderId,
          supplierTrackingNumber: dto.trackingNumber || null,
        },
      });
    }

    return po;
  }

  async getPurchaseOrders() {
    return this.prisma.purchaseOrder.findMany({
      orderBy: { purchasedAt: 'desc' },
      include: {
        order: {
          select: {
            orderNumber: true,
            customerName: true,
            totalAmount: true,
          },
        },
      },
    });
  }

  async getSupplierAccounts() {
    return this.prisma.supplierAccount.findMany({
      where: { isActive: true },
    });
  }
}
