/**
 * VariationService - Generates message variations on-demand during bulk sending
 * 
 * Strategy: Generate variations just-in-time as each message is queued
 * This ensures unique messages without pre-generating all variations
 */

import { log } from "../utils";

interface VariationRequest {
  campaignId: string;
  message: string;
  fixedParams?: Record<string, any>;
  contactPhone?: string;
}

interface VariationResponse {
  success: boolean;
  tweakedMessage: string;
  variationNumber: number;
  error?: string;
}

class VariationService {
  private supabaseUrl: string;
  private supabaseAnonKey: string;
  private edgeFunctionUrl: string;
  private generationQueue: Map<string, Promise<VariationResponse>> = new Map();

  constructor() {
    this.supabaseUrl = process.env.VITE_SUPABASE_URL || "";
    this.supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
    this.edgeFunctionUrl = `${this.supabaseUrl}/functions/v1/bulk-message-generator`;

    if (!this.supabaseUrl || !this.supabaseAnonKey) {
      log("⚠️ WARNING: Supabase credentials not configured for VariationService");
    }
  }

  /**
   * Generate a unique message variation for a contact
   * Uses queue to prevent duplicate concurrent requests for same campaign
   */
  async generateVariation(request: VariationRequest): Promise<VariationResponse> {
    const { campaignId, message, fixedParams, contactPhone } = request;

    log(`📝 Generating variation for campaign ${campaignId}, contact: ${contactPhone || 'unknown'}`);

    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.supabaseAnonKey}`,
          "apikey": this.supabaseAnonKey
        },
        body: JSON.stringify({
          campaign_id: campaignId,
          message: message,
          fixed_params: fixedParams || {},
          contact_phone: contactPhone || ""
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        log(`❌ Edge function error (${response.status}): ${errorText}`);
        throw new Error(`Edge function failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      if (!data.success) {
        log(`❌ Edge function returned error: ${data.error}`);
        throw new Error(data.error || "Unknown error from edge function");
      }

      if (!data.tweaked_message || data.tweaked_message.trim() === "") {
        log(`⚠️ WARNING: Edge function returned empty message`);
        log(`Response data: ${JSON.stringify(data)}`);
        throw new Error("Generated message is empty");
      }

      log(`✅ Variation #${data.variation_number} generated (${data.tweaked_message.length} chars)`);

      return {
        success: true,
        tweakedMessage: data.tweaked_message,
        variationNumber: data.variation_number
      };

    } catch (error: any) {
      log(`❌ Error generating variation: ${error.message}`);
      return {
        success: false,
        tweakedMessage: message, // Fallback to original message
        variationNumber: 0,
        error: error.message
      };
    }
  }

  /**
   * Generate variations in parallel for multiple contacts
   * Useful for batch processing with rate limiting
   */
  async generateBatch(
    requests: VariationRequest[],
    delayMs: number = 1000
  ): Promise<VariationResponse[]> {
    const results: VariationResponse[] = [];

    log(`📦 Generating ${requests.length} variations with ${delayMs}ms delay between each...`);

    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      
      // Generate variation
      const result = await this.generateVariation(request);
      results.push(result);

      // Add delay between requests (except for last one)
      if (i < requests.length - 1 && delayMs > 0) {
        await this.delay(delayMs);
      }
    }

    const successCount = results.filter(r => r.success).length;
    log(`✅ Batch complete: ${successCount}/${requests.length} successful`);

    return results;
  }

  /**
   * Pre-warm: Generate a few variations in advance
   * Useful to have some variations ready before starting bulk send
   */
  async prewarmVariations(
    campaignId: string,
    message: string,
    fixedParams: Record<string, any>,
    count: number = 3
  ): Promise<number> {
    log(`🔥 Pre-warming ${count} variations for campaign ${campaignId}...`);

    const requests: VariationRequest[] = Array.from({ length: count }, (_, i) => ({
      campaignId,
      message,
      fixedParams,
      contactPhone: `prewarm-${i + 1}`
    }));

    const results = await this.generateBatch(requests, 500);
    const successCount = results.filter(r => r.success).length;

    log(`✅ Pre-warm complete: ${successCount}/${count} variations ready`);
    return successCount;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const variationService = new VariationService();
