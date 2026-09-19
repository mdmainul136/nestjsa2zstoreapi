import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  Param,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NbrService } from './nbr.service';
import { DateFilterDto } from './dto/date-filter.dto';

@ApiTags('NBR & Tax Audit')
@Controller('nbr')
export class NbrController {
  constructor(private readonly nbrService: NbrService) {}

  @ApiOperation({ summary: 'NBR সার্বিক স্ট্যাটস ও অডিট রেডিনেস স্কোর' })
  @Get('stats')
  async getStats(@Query() query: DateFilterDto) {
    return this.nbrService.getStats(query);
  }

  @ApiOperation({ summary: 'মূসক ৬.২ বিক্রয় রেজিস্টার (Sales Sub-Register)' })
  @Get('sales-register')
  async getSalesRegister(@Query() query: DateFilterDto) {
    return this.nbrService.getSalesRegister(query);
  }

  @ApiOperation({ summary: 'মূসক ৬.১ ক্রয় ও আমদানি রেজিস্টার (Purchase Register)' })
  @Get('purchase-register')
  async getPurchaseRegister(@Query() query: DateFilterDto) {
    return this.nbrService.getPurchaseRegister(query);
  }

  @ApiOperation({ summary: 'মূসক ৯.১ মাসিক মূসক রিটার্ন ড্রাফট ও ব্রেকডাউন' })
  @Get('mushak-9-1')
  async getMushak91(@Query() query: DateFilterDto) {
    return this.nbrService.getMushak91(query);
  }

  @ApiOperation({ summary: 'নির্দিষ্ট অর্ডারের মূসক ৬.৩ কর চালানপত্র ডেটা' })
  @Get('mushak-6-3/:orderId')
  async getMushak63Invoice(@Param('orderId') orderId: string) {
    return this.nbrService.getMushak63Invoice(orderId);
  }

  @ApiOperation({ summary: 'HS Code ও কাস্টমস ট্যারিফ শিডিউল' })
  @Get('hs-codes')
  async getHsCodes() {
    return this.nbrService.getHsCodes();
  }

  @ApiOperation({ summary: 'HS Code অনুযায়ী মোট আমদানিকৃত ওজন (Kg) ও ই-কমার্স মূসক সামারি' })
  @Get('hs-weight-summary')
  async getHsCodeWeightSummary(@Query() query: DateFilterDto) {
    return this.nbrService.getHsCodeWeightSummary(query);
  }

  @ApiOperation({ summary: 'কোম্পানি ট্যাক্স প্রোফাইল ও BIN সেটিংস' })
  @Get('settings')
  async getSettings() {
    return this.nbrService.getSettings();
  }

  @ApiOperation({ summary: 'কোম্পানি ট্যাক্স প্রোফাইল আপডেট' })
  @Patch('settings')
  async updateSettings(@Body() body: any) {
    return this.nbrService.updateSettings(body);
  }

  @ApiOperation({ summary: 'NBR অডিট প্যাক CSV এক্সপোর্ট' })
  @Get('audit-export')
  async exportAuditCsv(
    @Query() query: DateFilterDto,
    @Res() res: any,
  ) {
    const csvData = await this.nbrService.exportAuditCsv(query);
    const filename = `NBR_Audit_Sales_Register_${query.period || 'all'}_${new Date().toISOString().slice(0, 10)}.csv`;

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvData);
  }
}
