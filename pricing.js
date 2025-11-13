/**
 * Pricing module for Claude API models
 * Provides pricing constants and cost calculation utilities
 */

// Current Claude API pricing per million tokens (as of 2025)
const MODEL_PRICING = {
    'claude-haiku-4-5-20251001': {
        name: 'Haiku 4.5',
        inputPrice: 0.80,      // $0.80 per million input tokens
        outputPrice: 4.00,     // $4.00 per million output tokens
    },
    'claude-3-7-sonnet-20250219': {
        name: 'Sonnet 3.7',
        inputPrice: 3.00,      // $3.00 per million input tokens
        outputPrice: 15.00,    // $15.00 per million output tokens
    },
    'claude-sonnet-4-5-20250929': {
        name: 'Sonnet 4.5',
        // Sonnet 4.5 has dynamic pricing based on prompt length
        inputPrice: 3.00,      // $3.00 per million input tokens (≤200K tokens)
        outputPrice: 15.00,    // $15.00 per million output tokens (≤200K tokens)
        // Pricing for prompts > 200K tokens:
        inputPriceOverLimit: 6.00,      // $6.00 per million input tokens
        outputPriceOverLimit: 22.50,    // $22.50 per million output tokens
        tokenLimitThreshold: 200000,    // Threshold for higher pricing
        isDynamic: true
    },
    'claude-opus-4-1-20250805': {
        name: 'Opus 4.1',
        inputPrice: 15.00,     // $15.00 per million input tokens
        outputPrice: 75.00,    // $75.00 per million output tokens
    }
};

/**
 * Get pricing information for a specific model
 * @param {string} modelId - The model ID
 * @returns {Object} Pricing object with name, inputPrice, and outputPrice
 */
function getPricing(modelId) {
    return MODEL_PRICING[modelId] || MODEL_PRICING['claude-sonnet-4-5-20250929'];
}

/**
 * Get pricing for a specific prompt length (handles Sonnet 4.5 dynamic pricing)
 * @param {string} modelId - The model ID
 * @param {number} inputTokens - Number of input tokens
 * @returns {Object} Pricing object with appropriate rates
 */
function getPricingForPromptLength(modelId, inputTokens) {
    const basePricing = getPricing(modelId);

    // Check if this is Sonnet 4.5 and if we need to apply higher pricing
    if (basePricing.isDynamic && inputTokens > basePricing.tokenLimitThreshold) {
        return {
            ...basePricing,
            inputPrice: basePricing.inputPriceOverLimit,
            outputPrice: basePricing.outputPriceOverLimit,
            pricingTier: 'over_limit'
        };
    }

    return {
        ...basePricing,
        pricingTier: 'standard'
    };
}

/**
 * Calculate cost for tokens
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {string} modelId - The model ID
 * @returns {Object} Cost breakdown with totalCost, inputCost, outputCost in USD
 */
function calculateCost(inputTokens, outputTokens, modelId) {
    const pricing = getPricingForPromptLength(modelId, inputTokens);

    // Convert tokens to millions and calculate cost
    const inputCost = (inputTokens / 1000000) * pricing.inputPrice;
    const outputCost = (outputTokens / 1000000) * pricing.outputPrice;
    const totalCost = inputCost + outputCost;

    const result = {
        inputCost: parseFloat(inputCost.toFixed(6)),
        outputCost: parseFloat(outputCost.toFixed(6)),
        totalCost: parseFloat(totalCost.toFixed(6)),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        modelName: pricing.name
    };

    // Add pricing tier info for dynamic models
    if (pricing.isDynamic) {
        result.pricingTier = pricing.pricingTier;
        result.inputPricePerMillion = pricing.inputPrice;
        result.outputPricePerMillion = pricing.outputPrice;
        if (pricing.pricingTier === 'over_limit') {
            result.note = `Sonnet 4.5 higher pricing tier (prompt > 200K tokens)`;
        }
    }

    return result;
}

/**
 * Calculate cumulative cost from multiple usage records
 * @param {Array} usageRecords - Array of objects with {inputTokens, outputTokens, model}
 * @returns {Object} Aggregated cost breakdown
 */
function calculateCumulativeCost(usageRecords) {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    usageRecords.forEach(record => {
        totalInputTokens += record.inputTokens || 0;
        totalOutputTokens += record.outputTokens || 0;

        const cost = calculateCost(
            record.inputTokens || 0,
            record.outputTokens || 0,
            record.model
        );
        totalCost += cost.totalCost;
    });

    return {
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalCost: parseFloat(totalCost.toFixed(6)),
        recordCount: usageRecords.length
    };
}

/**
 * Extract usage information from Claude API response
 * @param {Object} message - The message response from Claude API
 * @returns {Object} Usage object with inputTokens and outputTokens
 */
function extractUsage(message) {
    if (!message || !message.usage) {
        return { inputTokens: 0, outputTokens: 0 };
    }

    const usage = message.usage;
    return {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
        cacheReadInputTokens: usage.cache_read_input_tokens || 0
    };
}

/**
 * Format cost as a readable string
 * @param {number} costInUSD - Cost in USD
 * @returns {string} Formatted cost string
 */
function formatCost(costInUSD) {
    if (costInUSD < 0.001) {
        return `$${(costInUSD * 1000000).toFixed(2)}µ`; // Micro-dollars
    } else if (costInUSD < 0.01) {
        return `$${(costInUSD * 1000).toFixed(2)}m`; // Milli-dollars
    } else {
        return `$${costInUSD.toFixed(4)}`;
    }
}

/**
 * Format tokens as a readable string
 * @param {number} tokens - Number of tokens
 * @returns {string} Formatted token string
 */
function formatTokens(tokens) {
    if (tokens >= 1000000) {
        return `${(tokens / 1000000).toFixed(2)}M`;
    } else if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`;
    } else {
        return `${tokens}`;
    }
}

module.exports = {
    MODEL_PRICING,
    getPricing,
    getPricingForPromptLength,
    calculateCost,
    calculateCumulativeCost,
    extractUsage,
    formatCost,
    formatTokens
};
