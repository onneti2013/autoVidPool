const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function generateVideo() {
    console.log('Iniciando geração de vídeo...');
    
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        // Carregar o HTML
        const htmlPath = path.join(__dirname, 'index.html');
        await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

        // Aguardar que a página esteja pronta
        await page.waitForFunction('window.pageReady === true', { timeout: 30000 });

        console.log('Página carregada, iniciando geração...');

        // Executar a geração do vídeo
        const result = await page.evaluate(async () => {
            try {
                const videoData = await window.generateVideoForPuppeteer();
                return videoData;
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        if (result.success) {
            // Criar pasta output
            const outputDir = path.join(__dirname, 'output');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir);
            }

            // Salvar vídeo
            const videoBuffer = Buffer.from(result.video);
            fs.writeFileSync(path.join(outputDir, 'video.webm'), videoBuffer);

            // Salvar áudio
            const audioBuffer = Buffer.from(result.audio);
            fs.writeFileSync(path.join(outputDir, 'audio.wav'), audioBuffer);

            console.log('Arquivos salvos com sucesso!');
        } else {
            throw new Error('Falha na geração: ' + result.error);
        }

    } finally {
        await browser.close();
    }
}

generateVideo()
    .then(() => {
        console.log('Concluído!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Erro:', error);
        process.exit(1);
    });
