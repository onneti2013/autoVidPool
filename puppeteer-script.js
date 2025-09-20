const puppeteer = require('puppeteer');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Variáveis globais para o servidor
let server;

async function startServer() {
    const app = express();
    app.use(express.static(__dirname)); 
    
    return new Promise(resolve => {
        server = app.listen(0, () => {
            console.log(`Servidor local iniciado na porta ${server.address().port}`);
            resolve(server.address().port);
        });
    });
}

async function generateVideo(port) {
    console.log('Iniciando geração de vídeo...');
    const theme = process.env.THEME || 'Curiosidades sobre o MAR';
    const aspectRatio = process.env.ASPECT_RATIO || '9:16';
    const durationType = process.env.DURATION_TYPE || 'curto';
    const language = process.env.LANGUAGE_VID || 'português do Brasil'; // Corrigido 'Brazil' para 'Brasil'

    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    
    if (!geminiKey || !groqKey) {
        throw new Error('Chaves de API não encontradas.');
    }
    
    const browser = await puppeteer.launch({
        headless: 'new',
        // ================== CORREÇÃO COM BASE NO SEU DADO ==================
        // Aumentando para 1 hora (3.600.000 ms) para garantir que a geração de
        // assets de vídeos longos nunca seja interrompida.
        protocolTimeout: 3600000, 
        // ==================================================================
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ]
    })

    try {
        const page = await browser.newPage();
        page.on('console', msg => console.log('LOG DO NAVEGADOR:', msg.text()));

        await page.setViewport({ width: 1200, height: 800 });

        // ================== CORREÇÃO APLICADA AQUI ==================
        // Agora a função recebe TODAS as variáveis necessárias
        await page.evaluateOnNewDocument((theme, aspectRatio, durationType, language, geminiKey, groqKey) => {
            window.THEME = theme;
            window.ASPECT_RATIO = aspectRatio;
            window.DURATION_TYPE = durationType;
            window.LANGUAGE_VID = language;
            
            window.GEMINI_API_KEY = geminiKey;
            window.GROQ_API_KEY = groqKey;
        }, theme, aspectRatio, durationType, language, geminiKey, groqKey); // E TODAS são passadas aqui
        // ==========================================================

        const pageUrl = `http://localhost:${port}/index.html`;
        console.log(`Navegando para ${pageUrl}`);
        await page.goto(pageUrl, { waitUntil: 'networkidle0' });

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
        
        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
        fs.writeFileSync(path.join(outputDir, 'audio.wav'), audioBuffer);
        console.log(`Áudio salvo. Duração: ${audioDuration.toFixed(2)}s`);

        const FPS = 30;
        const totalFrames = Math.floor(audioDuration * FPS);
        const framesDir = path.join(outputDir, 'frames');
        if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
        fs.mkdirSync(framesDir);
        
        console.log(`Renderizando ${totalFrames} quadros a ${FPS} FPS...`);
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
    const port = await startServer();
    try {
        await generateVideo(port);
        await compileVideo();
        console.log('Processo concluído com sucesso!');
    } catch (error) {
        console.error('Erro fatal no processo:', error);
        process.exit(1);
    } finally {
        if (server) {
            server.close(() => console.log('Servidor local desligado.'));
        }
    }
}

main();
