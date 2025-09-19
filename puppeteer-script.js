const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

async function generateVideo() {
    console.log('Iniciando geração de vídeo...');
    const theme = process.env.THEME || 'Curiosidades sobre o MAR';
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    
    if (!geminiKey || !groqKey) {
        throw new Error('Chaves de API não encontradas.');
    }
    
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 }); // Viewport pode ser qualquer tamanho, não afeta o canvas

        // Injeta as chaves de API
        await page.evaluateOnNewDocument((theme, geminiKey, groqKey) => {
            window.THEME = theme;
            window.GEMINI_API_KEY = geminiKey;
            window.GROQ_API_KEY = groqKey;
        }, theme, geminiKey, groqKey);

        const htmlPath = path.join(__dirname, 'index.html');
        await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

        await page.waitForFunction('window.pageReady === true');
        console.log('Página carregada, preparando assets...');

        // ETAPA 1: Chamar a inicialização para gerar assets e obter duração
        const initResult = await page.evaluate(async () => {
            return await window.initializeGenerator();
        });

        if (!initResult.success) {
            throw new Error('Falha na inicialização: ' + initResult.error);
        }

        const audioDuration = initResult.duration;
        const audioBuffer = Buffer.from(initResult.audio);
        
        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
        fs.writeFileSync(path.join(outputDir, 'audio.wav'), audioBuffer);
        console.log(`Áudio salvo. Duração: ${audioDuration.toFixed(2)}s`);

        // ETAPA 2: Loop de renderização quadro a quadro
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
    
    // Comando FFmpeg para juntar frames PNG e áudio WAV
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

generateVideo()
    .then(compileVideo)
    .then(() => {
        console.log('Processo concluído com sucesso!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Erro fatal no processo:', error);
        process.exit(1);
    });
