import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  IsArray,
} from 'class-validator';

export class CreatePurchaseOrderDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsNotEmpty({ message: 'সাপ্লায়ারের নাম দিন (amazon, walmart)' })
  @IsString()
  supplierName: string;

  @IsNotEmpty({ message: 'আমাজনের অর্ডার নম্বর আবশ্যক' })
  @IsString()
  supplierOrderId: string;

  @IsNotEmpty({ message: 'মোট খরচ (USD) আবশ্যক' })
  @IsNumber()
  totalCostUsd: number;

  @IsOptional()
  @IsString()
  paymentCardLast4?: string; // e.g. "8821"

  @IsOptional()
  @IsString()
  trackingNumber?: string; // আমাজনের ইউএসপিএস/ইউপিএস ট্র্যাকিং

  @IsOptional()
  @IsString()
  invoiceUrl?: string; // ইনভয়েস পিডিএফ লিংক

  @IsOptional()
  @IsString()
  notes?: string;
}

export class BarcodeScanDto {
  @IsNotEmpty({ message: 'স্ক্যান করা বারকোড আবশ্যক' })
  @IsString()
  barcode: string;

  @IsNotEmpty({ message: 'স্ক্যান অ্যাকশন নির্বাচন করুন' })
  @IsString()
  action:
    | 'INBOUND_RECEIVE'
    | 'BIN_ALLOCATION'
    | 'QC_INSPECTION'
    | 'REPACK_DISCARD'
    | 'DISPATCH_FLIGHT';

  @IsNotEmpty({ message: 'ওয়্যারহাউস আইডি আবশ্যক' })
  @IsString()
  warehouseId: string;

  @IsOptional()
  @IsString()
  locationCode?: string; // e.g. "LOC-USA-A02-RB-S04-B12"

  @IsOptional()
  @IsString()
  parcelId?: string;

  @IsOptional()
  @IsArray()
  photoUrls?: string[]; // আনবক্সিং ছবির গ্যালারি

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpsertWarehouseDto {
  @IsOptional() @IsString() id?: string;
  @IsNotEmpty() @IsString() code: string;
  @IsNotEmpty() @IsString() name: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsNotEmpty() @IsString() city: string;
  @IsNotEmpty() @IsString() address: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() repackingAvailable?: boolean;
  @IsOptional() consolidationAvailable?: boolean;
  @IsOptional() photoCheckAvailable?: boolean;
  @IsOptional() qcAvailable?: boolean;
  @IsOptional() @IsString() shipmentFrequency?: string;
  @IsOptional() @IsArray() shipmentDays?: string[];
  @IsOptional() @IsString() cutoffTime?: string;
  @IsOptional() nextShipmentDate?: Date | string;
  @IsOptional() @IsString() shipmentNotice?: string;
  @IsOptional() @IsNumber() transitDaysMin?: number;
  @IsOptional() @IsNumber() transitDaysMax?: number;
  @IsOptional() isActive?: boolean;
}

export class UpdateWarehouseScheduleDto {
  @IsOptional() @IsString() shipmentFrequency?: string;
  @IsOptional() @IsArray() shipmentDays?: string[];
  @IsOptional() @IsString() cutoffTime?: string;
  @IsOptional() nextShipmentDate?: Date | string;
  @IsOptional() @IsString() shipmentNotice?: string;
  @IsOptional() @IsNumber() transitDaysMin?: number;
  @IsOptional() @IsNumber() transitDaysMax?: number;
}

export class UpsertCarrierDto {
  @IsOptional() @IsString() id?: string;
  @IsNotEmpty() @IsString() code: string;
  @IsNotEmpty() @IsString() name: string;
  @IsNotEmpty() @IsString() leg: 'DOMESTIC_US' | 'INTERNATIONAL_AIR' | 'LOCAL_BD';
  @IsNotEmpty() @IsString() serviceType: 'AIR_CARGO' | 'SEA_CARGO' | 'EXPRESS' | 'LAST_MILE';
  @IsOptional() @IsString() trackingUrlTemplate?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() contactEmail?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsString() apiEndpoint?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() isActive?: boolean;
}

export class CreateManifestDto {
  @IsNotEmpty() @IsString() warehouseId: string;
  @IsNotEmpty() @IsString() carrierName: string;
  @IsOptional() @IsString() carrierCode?: string;
  @IsOptional() @IsString() masterAwb?: string;
  @IsOptional() @IsString() flightNumber?: string;
  @IsOptional() @IsString() originCountry?: string;
  @IsOptional() @IsString() destCountry?: string;
  @IsOptional() departureDate?: Date | string;
  @IsOptional() estimatedArrivalDate?: Date | string;
  @IsOptional() @IsArray() parcelIds?: string[];
  @IsOptional() @IsString() notes?: string;
}

export class UpdateManifestStatusDto {
  @IsNotEmpty() @IsString() status: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() actualArrivalDate?: Date | string;
}
