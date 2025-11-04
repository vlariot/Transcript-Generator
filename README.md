# Real Estate Coaching Transcript Generator

A web application that generates realistic real estate coaching call transcripts using Claude AI. Perfect for testing PII redaction tools and AI agent systems without risking real client data.

## Features

- Generate multiple transcripts in batch with a single click
- Realistic 25-30 minute coaching call conversations
- Diverse coach/client combinations with varied locations and topics
- Proper markdown formatting with session details and timestamps
- Real-time progress tracking during generation
- Automatic ZIP file creation for easy download
- Clean, modern web interface

## Prerequisites

- Node.js (v14 or higher)
- Claude API key from Anthropic

## Installation

1. **Open a terminal/command prompt in this directory:**
   ```bash
   cd C:\Applications\TranscriptGenerator
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

## Getting a Claude API Key

1. Visit https://console.anthropic.com/
2. Sign up or log in to your account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (it starts with `sk-ant-api03-`)

**Important:** Keep your API key secure and never commit it to version control.

## Usage

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Open your browser:**
   Navigate to `http://localhost:3000`

3. **Fill in the form:**
   - **Claude API Key:** Enter your Anthropic API key
   - **Number of Transcripts:** Choose how many transcripts to generate (1-100)
   - **Generation Prompt:** The prompt is pre-filled with the specifications. You can modify it if needed.

4. **Generate:**
   - Click "Generate Transcripts"
   - Watch the progress bar as transcripts are created
   - When complete, download the ZIP file containing all transcripts

## Output Format

Each transcript is saved as a markdown (.md) file with the naming convention:
```
coachname_clientname_date_number.md
```

Example: `sarah_thompson_john_martinez_2024-08-15_1.md`

### Transcript Structure

```markdown
# Coaching Session:
Coach Name & Client Name - 2025-09-23

## Session Details
**Coach:** [Name]
**Client:** [Name]
**Coach Email:** [email@example.com]
**Client Email:** [email@example.com]
**Start Time:** [date/time]
**Duration:** [xx minutes]

---

## Transcript
00:00:00 - Client Name
[dialogue]

00:00:15 - Coach Name
[dialogue]

[... continues for 25-30 minutes]
```

## Technical Details

### Tech Stack
- **Backend:** Node.js + Express
- **AI:** Anthropic Claude API (claude-sonnet-4-5-20250929)
- **File Handling:** Archiver (ZIP creation)
- **Frontend:** Vanilla JavaScript with Server-Sent Events for real-time updates

### Project Structure
```
TranscriptGenerator/
├── server.js           # Express server & Claude API integration
├── package.json        # Dependencies and scripts
├── README.md          # This file
├── public/            # Frontend files
│   ├── index.html     # Main web interface
│   ├── styles.css     # Styling
│   └── script.js      # Client-side logic
└── temp/              # Temporary storage (auto-created)
```

### Rate Limiting

The application includes a 1-second delay between API calls to avoid rate limiting. For large batches (60+ transcripts), expect:
- ~1-2 minutes per transcript (depending on API response time)
- Total time for 60 transcripts: approximately 60-120 minutes

## Cost Considerations

Claude API pricing is based on tokens:
- Each transcript uses approximately 10,000-15,000 output tokens
- Check current pricing at https://www.anthropic.com/pricing
- For 60 transcripts, expect to use ~600,000-900,000 tokens

## Troubleshooting

### Port Already in Use
If you see "Port 3000 is already in use":
1. Change the PORT variable in `server.js` (line 6)
2. Or stop any other service using port 3000

### API Key Errors
- Verify your API key is correct and active
- Check you have sufficient credits in your Anthropic account
- Ensure the API key starts with `sk-ant-api03-`

### Generation Failures
- Check your internet connection
- Reduce the number of transcripts per batch
- Review Claude API status at https://status.anthropic.com/

### Memory Issues
For very large batches (100+), you may need to increase Node.js memory:
```bash
node --max-old-space-size=4096 server.js
```

## Security Notes

- API keys are never stored on the server
- Temporary files are automatically cleaned up after 1 hour
- All data processing happens locally on your machine
- ZIP files are deleted after download

## Customization

### Modify the Prompt
Edit the default prompt in `public/index.html` (line 35) to change:
- Call duration
- Topics covered
- Coach/client dynamics
- Geographic locations
- Number of follow-up series

### Change AI Model
Edit `server.js` (line 81) to use a different Claude model:
```javascript
model: 'claude-3-5-sonnet-20241022',  // Change this
```

Available models:
- `claude-3-5-sonnet-20241022` (recommended - best balance)
- `claude-3-opus-20240229` (highest quality, slower)
- `claude-3-haiku-20240307` (fastest, lower cost)

## License

ISC

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Claude API documentation: https://docs.anthropic.com/
3. Ensure all dependencies are correctly installed

---

**Note:** This tool generates dummy data for testing purposes only. The transcripts contain fictional names, emails, and conversations.
