const fs = require('fs');
const { google } = require('googleapis');

const OAUTH2_CLIENT = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
);
OAUTH2_CLIENT.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const YOUTUBE = google.youtube({ version: 'v3', auth: OAUTH2_CLIENT });
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const privacyStatus = process.env.YOUTUBE_VISIBILITY || 'private';

async function generateYouTubeMetadata(scriptText, language, theme) {
    console.log('Gerando metadados do vídeo com a IA...');
    const prompt = `Based on the following video script about "${theme}", generate a YouTube video title, description, and tags. The output MUST be in a valid JSON format like this: {"title": "...", "description": "...", "tags": ["tag1", "tag2", ...]}. The language for the title, description, and tags MUST be: ${language}. The tone should be engaging and optimized for SEO. Here is the script: "${scriptText}"`;
    try {
        const response = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const data = await response.json();
        const jsonString = data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
        return JSON.parse(jsonString);
    } catch (error) {
        console.error("Erro ao gerar metadados. Usando fallback.", error);
        return { title: theme, description: scriptText.substring(0, 500), tags: [theme.toLowerCase().replace(/\s/g, '')] };
    }
}

async function uploadVideo() {
    const videoPath = './output/final-video.mp4';
    const scriptText = fs.readFileSync('./output/roteiro.txt', 'utf-8');
    const language = process.env.LANGUAGE_VID || 'português do Brasil';
    const theme = process.env.THEME;

    const metadata = await generateYouTubeMetadata(scriptText, language, theme);

    console.log('Iniciando upload para o YouTube...');
    const response = await YOUTUBE.videos.insert({
        part: 'id,snippet,status',
        requestBody: {
            snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags, categoryId: '28' },
            status: { privacyStatus: privacyStatus },
        },
        media: { body: fs.createReadStream(videoPath) },
    });
    console.log(`Upload concluído! Link: https://www.youtube.com/watch?v=${response.data.id}`);
}

uploadVideo().catch(err => { console.error("Erro fatal no script de upload:", err); process.exit(1); });
