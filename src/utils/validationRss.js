import axios from 'axios'
import RSSParser from 'rss-parser'
import { logger } from './logger.js' // Імпортуємо logger

const parser = new RSSParser()

// Перевірка, чи є RSS валідним
async function isValidRSS(url, config) {
	// Додаємо config як аргумент
	try {
		const response = await axios.get(url, { timeout: config.rssTimeout })
		const feed = await parser.parseString(response.data)
		return feed.items && feed.items.length > 0
	} catch (error) {
		logger.error(`Invalid RSS URL: ${url}`, error)
		return false
	}
}

export { isValidRSS }
