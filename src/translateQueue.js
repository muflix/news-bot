import { translate } from 'bing-translate-api'
import { logger } from './utils/logger.js'

class TranslateQueue {
	constructor(maxRequestsPerSecond) {
		this.queue = []
		this.maxRequestsPerSecond = maxRequestsPerSecond
		this.interval = 1000 / maxRequestsPerSecond // Інтервал між запитами в мілісекундах
		this.isRunning = false
	}

	enqueue(title) {
		return new Promise((resolve, reject) => {
			this.queue.push({ title, resolve, reject })
			if (!this.isRunning) {
				this.processQueue()
			}
		})
	}

	async processQueue() {
		if (this.isRunning) return
		this.isRunning = true

		while (this.queue.length > 0) {
			const { title, resolve, reject } = this.queue.shift()
			try {
				const translated = await this.translateToUkrainian(title)
				resolve(translated)
			} catch (error) {
				reject(error)
			}
			await new Promise(resolve => setTimeout(resolve, this.interval))
		}

		this.isRunning = false
	}

	async translateToUkrainian(title) {
		try {
			const res = await translate(title, null, 'uk')
			// logger.debug(`Translation successful: ${title} -> ${res.translation}`)
			// logger.debug(`Translation successful: ${title.id} -> ✅`)
			logger.debug(`Translation successful: ${title} -> ✅`)
			return res.translation
		} catch (error) {
			logger.error(`Translation error for title: ${title}`, error)
			return null // Якщо виникне помилка при перекладі, повертаємо null
		}
	}
}

export default TranslateQueue
