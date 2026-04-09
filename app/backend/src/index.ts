import express from 'express';
import mainRouter from "./routers/index.js";

const app = express();

app.use(express.json());

app.use('/api', mainRouter);

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(3000, () => {
    console.log('API Сервер запущено на http://localhost:3000');
});