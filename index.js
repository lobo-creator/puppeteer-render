import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import puppeteer from 'puppeteer';
import 'dotenv/config';
import axios from 'axios';

const app = express();
const server = createServer(app);

// Configurar opciones CORS para Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Ruta para enviar un saludo
app.get('/hello', (req, res) => {
  res.send('¡Hola!');
});

// Funciones auxiliares
const getCurrentDate = () => new Date().toISOString().slice(0, 10);

const insertCard = async (date, number, color) => {
  try {
    const response = await axios.post('https://www.ivanlovo.com/pancake/add_card.php', {
      date,
      number,
      color
    });

    if (response.data.status === 'success') {
      console.log('New card stored: #', number);
    } else {
      console.error('Failed to store card');
    }
  } catch (err) {
    console.error('Error al insertar datos:', err.message);
  }
};

const setupPuppeteer = async () => {
  console.log('Puppeteer executable path:', process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath());
  
  const browser = await puppeteer.launch({
    args: [
      "--disable-setuid-sandbox",
      "--no-sandbox",
      "--single-process",
      "--no-zygote",
    ],
    headless: true,  // Asegura que Puppeteer esté en modo sin cabeza
    executablePath:
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_EXECUTABLE_PATH
        : puppeteer.executablePath(),
  });

  const page = await browser.newPage();
  await page.goto('https://pancakeswap.finance/prediction?token=BNB', { waitUntil: 'networkidle2', timeout: 60000 }); // Aumenta el tiempo de espera

  await page.waitForSelector('#responsibility-checkbox');
  await page.click('#responsibility-checkbox');
  await page.waitForSelector('#beta-checkbox');
  await page.click('#beta-checkbox');
  await page.waitForSelector('#predictions-risk-disclaimer-continue');
  await page.click('#predictions-risk-disclaimer-continue');

  return { browser, page };
};

const getID = async (page) => {
  return page.evaluate(() => {
    const element = document.querySelector('.swiper-slide-prev');
    if (element) {
      const match = element.textContent.match(/#(\d{5,7})/);
      return match ? match[1] : null;
    }
    return null;
  });
};

const getColor = async (page) => {
  return page.evaluate(() => {
    const element = document.querySelector(".swiper-slide-prev > div > div > div > div > div > div > div:nth-of-type(2) > div");
    if (element) {
      return window.getComputedStyle(element).getPropertyValue('color');
    }
    return null;
  });
};

const getCurrentColor = async (page) => {
  return page.evaluate(() => {
    const element = document.querySelector(".swiper-slide-active > div > div > div > div > div > div > div:nth-of-type(1) > div")
    if (element) {
      return window.getComputedStyle(element).getPropertyValue('color');
    }
    return null;
  });
};

const getTimer = async (page) => {
  return page.evaluate(() => {
    const element = document.querySelector("#__next > div > div > div > div > div > div > div > div > div > div:nth-child(3) > div > div > div > div > div")
    return element ? element.textContent.replace(/^0/, '').replace(':', '') : null;
  });
};

let matches = 1;
let prevColor = null;

const countMatching = async (color) => {
  if (prevColor === null) {
    prevColor = color;
  } else {
    if (color === prevColor) {
      matches++;
    } else {
      matches = 1;
    }
    prevColor = color;
  }

  console.log(`Color actual: ${color}, Matches: ${matches}`);
};

let numeroAnterior = null;

const checkAndUpdateID = async (page) => {
  const numero = await getID(page);
  const color = await getColor(page);

  if (numero !== null && numero !== numeroAnterior) {
    let colorValue;
    if (color === "rgb(49, 208, 170)") {
      colorValue = 1;
    } else if (color === "rgb(237, 75, 158)") {
      colorValue = 2;
    } else {
      colorValue = 3;
    }
    await insertCard(getCurrentDate(), numero, colorValue);
    io.emit('addCard', { numero, colorValue });
    countMatching(colorValue);

    numeroAnterior = numero;
    return { numero, color, colorValue };
  }
  return null;
};

// Función principal
const main = async () => {
  try {
    const { browser, page } = await setupPuppeteer();

    let totalClientes = 0;

    io.on('connection', (socket) => {
      totalClientes++;
      console.log('Nuevo cliente conectado');
      console.log('Total de clientes conectados:', totalClientes);

      socket.on('disconnect', () => {
        totalClientes--;
        console.log('Cliente desconectado');
        console.log('Total de clientes conectados:', totalClientes);
      });
    });

    setInterval(async () => {
      try {
        const timer = await getTimer(page);
        const updatedData = await checkAndUpdateID(page);
        const cardCurrentColor = await getCurrentColor(page);

        if (timer) io.emit('receiveData', { timer, cardCurrentColor });

        if (updatedData) {
          // console.log('Timer:', timer, 'Color:', updatedData.color, 'Valor de color:', updatedData.colorValue, 'ID actualizado:', updatedData.numero);
        } else {
          // console.log('Timer:', timer, 'Sin actualizaciones de ID');
        }
      } catch (error) {
        console.error('Error en el intervalo:', error);
      }
    }, 1000);

    const PORT = process.env.PORT || 4000;

    server.listen(PORT, '0.0.0.0', () => {  // Asegura que el servidor escucha en 0.0.0.0
      console.log(`Servidor escuchando en el puerto ${PORT}`);
    });

  } catch (error) {
    console.error('Error principal:', error);
  }
};

main();
