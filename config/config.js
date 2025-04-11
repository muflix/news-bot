import 'dotenv/config'

// Завантаження конфігурації з .env
const config = {
	aiToken: process.env.AI_TOKEN,
	botApiKey: process.env.BOT_API_KEY,
	rssTimeout: parseInt(process.env.RSS_TIMEOUT || '5000'), // Тайм-аут для RSS запитів
	newsLimit: parseInt(process.NEWS_LIMIT || '40'), // Максимальна кількість новин для відправки
	messagesPerChunk: parseInt(process.MESSAGES_PER_CHUNK || '8'), // Кількість новин в одному повідомленні
	translationEnabled: process.env.TRANSLATION_ENABLED === 'true', // Чи ввімкнено переклад
	translationDelay: parseInt(process.env.TRANSLATION_DELAY || '1000'), // Затримка між перекладами
	maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '2'), // Максимальна кількість запитів на переклад в секунду
}

export default config
