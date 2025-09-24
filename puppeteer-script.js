const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');


async function sendErrorToWebhook(error, agentId) {
    try {
        const https = require('https');
        const querystring = require('querystring');
        
        const postData = querystring.stringify({
            'agent_id': agentId,
            'error': error.toString()
        });

        const options = {
            hostname: 'wg1.space',
            path: '/autovidpool/retry.php',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                console.log(`Webhook response status: ${res.statusCode}`);
                resolve();
            });

            req.on('error', (e) => {
                console.error('Erro ao enviar para webhook:', e.message);
                resolve();
            });

            req.write(postData);
            req.end();
        });
    } catch (webhookError) {
        console.error('Erro na função sendErrorToWebhook:', webhookError.message);
    }
}


async function generateVideo() {
    console.log('Iniciando geração de vídeo...');
    const theme = process.env.THEME || 'Curiosidades sobre o MAR';
    const aspectRatio = process.env.ASPECT_RATIO || '9:16';
    const durationType = process.env.DURATION_TYPE || 'curto';
    const language = process.env.LANGUAGE_VID || 'Brazilian Portuguese';
    const voice = process.env.VOICE_NAME || 'Kore';
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const agent_id = process.env.AGENT_ID || '1';

    if (!geminiKey || !groqKey) {
        throw new Error('Chaves de API não encontradas nos secrets.');
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        protocolTimeout: 3600000, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ]
    });

    try {
        const page = await browser.newPage();
        page.on('console', msg => console.log('LOG DO NAVEGADOR:', msg.text()));

        await page.evaluateOnNewDocument((theme, aspectRatio, durationType, language, voice, geminiKey, groqKey, agent_id) => {
            window.THEME = theme;
            window.ASPECT_RATIO = aspectRatio;
            window.DURATION_TYPE = durationType;
            window.LANGUAGE_VID = language;
            window.VOICE_NAME = voice;
            window.GEMINI_API_KEY = geminiKey;
            window.GROQ_API_KEY = groqKey;
            window.AGENT_ID = agent_id;
        }, theme, aspectRatio, durationType, language, voice, geminiKey, groqKey, agent_id);

        const htmlPath = path.join(__dirname, 'index.html');
        await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

        await page.waitForFunction('window.pageReady === true');
        console.log('Página carregada, preparando assets...');

        const initResult = await page.evaluate(async () => {
            return await window.initializeGenerator();
        }, { timeout: 300000 });

        if (!initResult.success) {
            throw new Error('Falha na inicialização: ' + initResult.error);
        }

        const audioDuration = initResult.duration;
        const audioBuffer = Buffer.from(initResult.audio);
        const scriptText = initResult.script; // Pega o roteiro

        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
        fs.writeFileSync(path.join(outputDir, 'audio.wav'), audioBuffer);
        fs.writeFileSync(path.join(outputDir, 'roteiro.txt'), scriptText); // Salva o roteiro
        console.log(`Áudio e Roteiro salvos.`);

        const FPS = 30;
        const totalFrames = Math.floor(audioDuration * FPS);
        const framesDir = path.join(outputDir, 'frames');
        if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
        fs.mkdirSync(framesDir);

        console.log(`Renderizando ${totalFrames} quadros...`);
        for (let i = 0; i < totalFrames; i++) {
            const currentTime = i / FPS;
            const base64Data = await page.evaluate((t) => window.renderFrame(t), currentTime);
            const framePath = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`);
            fs.writeFileSync(framePath, base64Data, 'base64');
            process.stdout.write(`Progresso: ${i + 1} / ${totalFrames} quadros\r`);
        }
        console.log('\nRenderização de quadros concluída.');

    } finally {
        await browser.close();
    }
}

async function compileVideo() {
    console.log('Iniciando FFmpeg para compilar o vídeo...');
    const outputDir = path.join(__dirname, 'output');
    const framesDir = path.join(outputDir, 'frames');
    const outputPath = path.join(outputDir, 'final-video.mp4');
    const FPS = 30;

    const ffmpegCommand = `ffmpeg -framerate ${FPS} -i "${path.join(framesDir, 'frame_%05d.png')}" -i "${path.join(outputDir, 'audio.wav')}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;

    await new Promise((resolve, reject) => {
        exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error('Erro no FFmpeg:', stderr);
                return reject(error);
            }
            console.log('FFmpeg finalizado.');
            resolve();
        });
    });
    console.log(`Vídeo final salvo em: ${outputPath}`);
}

async function main() {
    const agent_id = process.env.AGENT_ID || '1';
    
    try {
        await generateVideo();
        await compileVideo();
        console.log('Processo concluído com sucesso!');
    } catch (error) {
        const errorMessage = `Erro fatal no processo: ${error}`;
        console.error(errorMessage);
        
        await sendErrorToWebhook(error, agent_id);
        
        process.exit(1);
    }
}

main();
