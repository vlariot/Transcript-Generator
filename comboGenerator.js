/**
 * Generate a list of coach/client combos using Claude Haiku
 * For every 10 transcripts, 1 should be a 4-transcript series
 * So for 10 transcripts: 7 unique combos (3 singles + 1 series of 4)
 */

async function generateCombos(transcriptCount, apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey });

    // Calculate number of series (1 series per 10 transcripts)
    const numberOfSeries = Math.floor(transcriptCount / 10);
    const transcripsInSeries = numberOfSeries * 4;
    const remainingTranscripts = transcriptCount - transcripsInSeries;
    const totalUniqueCombos = numberOfSeries + remainingTranscripts;

    let prompt = `You must generate exactly ${totalUniqueCombos} coach/client combinations in JSON format.

STRUCTURE:
- ${numberOfSeries} items with "type": "series" (for 4-episode series)
- ${remainingTranscripts} items with "type": "single" (for standalone transcripts)

For EACH combination:
- coach: Diverse name (male or female, different ethnicities)
- client: Diverse name (male or female, different ethnicities)
- location: US city with state abbreviation (e.g., "Austin, TX")
- niche: One of these (residential sales, investment properties, first-time buyers, commercial real estate, property management, wholesaling, real estate marketing, investor networking)
- type: "series" or "single"

REQUIREMENTS:
- No name appears more than once (including Marcus)
- At least 3 different coach genders/identities
- At least 3 different client genders/identities
- At least 5 different US states
- Diverse niches

OUTPUT FORMAT - return ONLY this JSON, nothing else:
[
  ${Array(Math.min(3, numberOfSeries)).fill(0).map((_, i) => `{
  "coach": "Name",
  "client": "Name",
  "location": "City, STATE",
  "niche": "niche",
  "type": "series"
}`).join(',\n  ')},
  ...${remainingTranscripts} more with "type": "single"
]

CRITICAL:
1. Return ONLY the JSON array
2. EXACTLY ${numberOfSeries} items with "type": "series"
3. EXACTLY ${remainingTranscripts} items with "type": "single"
4. Total: EXACTLY ${totalUniqueCombos} items
5. No markdown, no explanations, no code blocks`;

    const message = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 4000,
        messages: [{
            role: 'user',
            content: prompt
        }]
    });

    let jsonText = message.content[0].text.trim();

    // Try to extract JSON if it's wrapped in markdown code blocks
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
    }

    let combos;
    try {
        combos = JSON.parse(jsonText);
    } catch (error) {
        throw new Error(`Failed to parse JSON response: ${error.message}\nResponse: ${jsonText.substring(0, 200)}`);
    }

    if (!Array.isArray(combos)) {
        throw new Error(`Expected array but got: ${typeof combos}`);
    }

    if (combos.length !== totalUniqueCombos) {
        throw new Error(`Expected ${totalUniqueCombos} combos but got ${combos.length}. Response: ${JSON.stringify(combos).substring(0, 200)}`);
    }

    // Validate series vs single counts
    const seriesCount = combos.filter(c => c.type === 'series' || c.seriesIndicator === 'series').length;
    const singleCount = combos.filter(c => c.type === 'single' || c.seriesIndicator === 'single').length;

    if (seriesCount !== numberOfSeries) {
        throw new Error(`Expected ${numberOfSeries} series combos but got ${seriesCount}`);
    }

    if (singleCount !== remainingTranscripts) {
        throw new Error(`Expected ${remainingTranscripts} single combos but got ${singleCount}`);
    }

    // Transform the response to match our internal structure
    const processedCombos = [];
    let seriesComboIndex = 0;

    for (let i = 0; i < combos.length; i++) {
        const combo = combos[i];

        if (combo.type === 'series' || combo.seriesIndicator === 'series') {
            // This combo is part of a series - create 4 episodes
            for (let episode = 1; episode <= 4; episode++) {
                processedCombos.push({
                    coach: combo.coach,
                    client: combo.client,
                    location: combo.location,
                    niche: combo.niche,
                    isSeriesEpisode: true,
                    seriesId: seriesComboIndex,
                    episodeNumber: episode,
                    totalEpisodes: 4
                });
            }
            seriesComboIndex++;
        } else if (combo.type === 'single' || combo.seriesIndicator === 'single') {
            // Single standalone transcript
            processedCombos.push({
                coach: combo.coach,
                client: combo.client,
                location: combo.location,
                niche: combo.niche,
                isSeriesEpisode: false,
                seriesId: null,
                episodeNumber: null,
                totalEpisodes: null
            });
        } else {
            throw new Error(`Unknown type for combo ${i}: ${combo.type || combo.seriesIndicator}`);
        }
    }

    return processedCombos;
}

module.exports = {
    generateCombos
};
