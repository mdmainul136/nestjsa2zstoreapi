import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export async function runBackgroundScrape(urlOrAsin: string): Promise<any> {
  try {
    const isAmazonOrWalmart =
      urlOrAsin.includes('amazon') ||
      urlOrAsin.includes('amzn') ||
      urlOrAsin.includes('walmart') ||
      /^[A-Z0-9]{10}$/.test(urlOrAsin); // Basic ASIN check

    if (!isAmazonOrWalmart) {
      return null;
    }

    const scriptPath = path.resolve(process.cwd(), 'extension/full_scraper.py');
    const { stdout } = await execAsync(`python "${scriptPath}" --fetch "${urlOrAsin}"`);
    
    // Parse the output line by line since there might be logs
    const lines = stdout.split('\n');
    let jsonResult = null;
    
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        if (lines[i].trim().startsWith('{')) {
          jsonResult = JSON.parse(lines[i].trim());
          break;
        }
      } catch (e) {
        // Ignore parsing errors for non-JSON lines
      }
    }
    
    return jsonResult;
  } catch (error) {
    console.error(`[BackgroundScraper] Error fetching ${urlOrAsin}:`, error);
    return null;
  }
}
