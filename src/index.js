import 'dotenv/config'
import admin from 'firebase-admin'
import fs from 'fs'
import { Bot, GrammyError, HttpError, Keyboard, session } from 'grammy'

import moment from 'moment' // Для обробки часу
import RSSParser from 'rss-parser'
import config from '../config/config.js'
import { processRequest } from './summarize.js'
import TranslateQueue from './translateQueue.js'
import { logger } from './utils/logger.js'
import { isValidRSS } from './utils/validationRss.js'

// Перевірка BOT_API_KEY
if (!config.botApiKey) {
	throw new Error('BOT_API_KEY is missing in .env file')
}

// Ініціалізація Firebase
const serviceAccount = JSON.parse(
	fs.readFileSync('./config/serviceAccount.json', 'utf-8')
)

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
	firestore: {
		ignoreUndefinedProperties: true, // Ігноруємо undefined властивості
	},
})

const db = admin.firestore()
const bot = new Bot(config.botApiKey)
const parser = new RSSParser()

// Налаштування сесій
bot.use(session())

const translateQueue = new TranslateQueue(config.maxRequestsPerSecond)

// Функція для перекладу з затримкою
async function translateWithDelay(title) {
	if (!config.translationEnabled) {
		// logger.debug(`Translation is disabled, returning original title: ${title}`)
		return title // Якщо переклад вимкнено, повертаємо оригінальний заголовок
	}
	// logger.debug(`translateWithDelay called for title: ${title}`)

	try {
		const translated = await translateQueue.enqueue(title)
		// logger.debug(`translateWithDelay returning translated title: ${translated}`)
		return translated
	} catch (error) {
		logger.error(`Translation error with queue for: ${title}`, error)
		return title // Повертаємо оригінальний заголовок у випадку помилки
	}
}

// Список команд бота
bot.api.setMyCommands([
	{
		command: 'start',
		description: 'Welcome message',
	},
	{
		command: 'addsource',
		description: 'Adding source',
	},
	{
		command: 'subscribe',
		description: 'List of  sources',
	},
	{
		command: '/ai',
		description: 'Message to AI',
	},
])

// Команда /start
// bot.command('start', ctx =>
// 	ctx.reply('Welcome! I will send you the latest news about Ukraine!')
// )
bot.command('start', async ctx => {
	const keyboards = new Keyboard()
		.text('Subscribe')
		.row()
		.text('Add source')
		.row()
		.text('Summarize')
		.resized()
	await ctx.reply('Welcome! I will send you the latest news about Ukraine!🇺🇦', {
		reply_markup: keyboards,
	})
})

bot.hears('Subscribe', async ctx => {
	await ctx.reply('🔍 Searching for news... Please wait a moment.')
	await ctx.react('👌')
	try {
		const rssUrlsSnapshot = await db.collection('rssFeeds').get()
		if (rssUrlsSnapshot.empty) {
			return ctx.reply('No sources found. Add one using /addsource')
		}

		const rssUrls = rssUrlsSnapshot.docs.map(doc => doc.data().url)

		const allNews = []

		for (const rssUrl of rssUrls) {
			try {
				const news = await getNews(rssUrl)
				allNews.push(...news)
			} catch (error) {
				logger.error(`Error getting news from ${rssUrl}`, error)
				ctx.reply(`❌ Failed to get news from ${rssUrl}.`)
			}
		}

		if (allNews.length === 0) {
			return ctx.reply('No new news about Ukraine available at the moment.')
		}

		let response = '📰 Latest news about Ukraine:\n'
		let newsCount = 0
		const newsMessages = []

		// Обмежуємо кількість новин та розбиваємо на повідомлення
		for (const item of allNews) {
			if (newsCount >= config.newsLimit) break

			try {
				if (item.title) {
					// logger.debug(`Processing news item with title: ${item.title}`)
					const translatedTitle = await translateWithDelay(item.title) // Переклад з затримкою
					// logger.debug(`Translated title: ${translatedTitle}`)
					const pubDate = item.pubDate
						? moment(item.pubDate).format('YYYY-MM-DD HH:mm')
						: ''

					response += `\n🔗 *${translatedTitle}*\n${item.link}\n${
						pubDate ? `Published on: ${pubDate}` : ''
					}\n`

					newsCount++

					if (newsCount % config.messagesPerChunk === 0) {
						newsMessages.push(response)
						response = ''
					}

					// Додаємо новину в Firestore
					await db.collection('sentNews').add({ title: item.title })
				} else {
					logger.warn('Skipping news item with undefined title')
				}
			} catch (error) {
				logger.error(`Error processing or sending news: ${item.title}`, error)
			}
		}

		// Відправляємо залишок
		if (response) {
			newsMessages.push(response)
		}

		await sendLargeMessage(ctx, newsMessages)
	} catch (error) {
		logger.error('Error in /subscribe command', error)
		ctx.reply('❌ Failed to retrieve news. Please try again later.')
	}
})

// Обробка команди "Add source"
bot.hears('Add source', async ctx => {
	ctx.session.waitingForRss = true // Встановлюємо стан
	await ctx.reply(
		'Send me  RSS-link to add it as a source. Example: https://example.com/rss'
	)

	// Один обробник для всіх текстових повідомлень
	bot.on('message:text', async ctx => {
		if (ctx.session?.waitingForRss) {
			const rssUrl = ctx.message.text.trim()
			if (!(await isValidRSS(rssUrl))) {
				return ctx.reply('❌ No valid  RSS-link. Try again.')
			}
			try {
				await db.collection('rssFeeds').add({ url: rssUrl })
				await ctx.react('🫡')
				ctx.reply(`✅ Source added: ${rssUrl}`)
			} catch (error) {
				ctx.reply('❌ Cant add this source.')
			}
			ctx.session.waitingForRss = false // Скидаємо стан
		}
	})
})

bot.hears('Summarize', async ctx => {
	await ctx.reply('🤖 Summarizing your text...')
	await ctx.react('👍')
	try {
		const botText = await processRequest(ctx.message.text)
		await ctx.reply(botText)
	} catch (error) {
		logger.error('Text processing error:', error)
		await ctx.reply('Сталася помилка при обробці запиту')
	}
})

// Команда /addsource
bot.command('addsource', async ctx => {
	const rssUrl = typeof ctx.match === 'string' ? ctx.match.trim() : ''
	if (!rssUrl) {
		return ctx.reply(
			'Please provide an RSS URL. Example: /addsource https://example.com/rss'
		)
	}

	if (!(await isValidRSS(rssUrl))) {
		return ctx.reply('❌ This is not a valid RSS feed. Please try again.')
	}

	try {
		await db.collection('rssFeeds').add({ url: rssUrl })
		ctx.reply(`✅ Source added: ${rssUrl}`)
		logger.info(`Added RSS source: ${rssUrl}`)
	} catch (error) {
		logger.error(`Error adding RSS source: ${rssUrl}`, error)
		ctx.reply('❌ Failed to add source.')
	}
})

// Перевірка, чи новина за сьогодні (враховує часовий пояс)
function isToday(pubDate) {
	const today = moment().startOf('day') // Початок сьогоднішнього дня
	const pubDateObj = moment(pubDate)
	return pubDateObj.isSame(today, 'day') // Перевірка, чи дата публікації в той самий день
}

// Перевірка, чи вже були надіслані ці новини
async function isNewsAlreadySent(title) {
	try {
		const snapshot = await db
			.collection('sentNews')
			.where('title', '==', title)
			.get()
		return !snapshot.empty
	} catch (error) {
		logger.error(`Error checking if news was already sent: ${title}`, error)
		return false // В разі помилки вважаємо, що новина не була відправлена, щоб не пропустити її
	}
}

// Фільтрація новин за Україною (з використанням регулярних виразів)
function isUkraineNews(title, description) {
	const keywordsString = process.env.NEWS_KEYWORDS || '' // Отримуємо рядок з .env
	const keywords = keywordsString.split(',') // Розбиваємо рядок на масив

	const regexes = keywords.map(keyword => new RegExp(keyword, 'i')) // 'i' для ігнорування регістру
	const text = (title + ' ' + description).toLowerCase()

	return regexes.some(regex => regex.test(text))
}

// Функція отримання новин
async function getNews(rssUrl) {
	try {
		const feed = await parser.parseURL(rssUrl)
		if (!feed.items || feed.items.length === 0) {
			logger.info(`No news items found in RSS feed: ${rssUrl}`)
			return [] // Повертаємо пустий масив, якщо немає новин
		}

		const filteredNews = feed.items.filter(item => {
			const title = item.title || ''
			const description = item.content || item.summary || ''
			return isUkraineNews(title, description) && isToday(item.pubDate)
		})

		// Отримуємо результати перевірки isNewsAlreadySent для кожної новини
		const sentNewsCheckResults = await Promise.all(
			filteredNews.map(item => isNewsAlreadySent(item.title))
		)

		// Фільтруємо новини, які ще не були відправлені
		const newNews = filteredNews.filter(
			(item, index) => !sentNewsCheckResults[index]
		)

		return newNews.map(item => ({
			title: item.title,
			link: item.link,
			pubDate: item.pubDate,
		}))
	} catch (error) {
		logger.error(`Error fetching or processing RSS feed: ${rssUrl}`, error)
		return [] // Повертаємо пустий масив, щоб не зупиняти обробку інших RSS-каналів
	}
}

// Функція для надсилання великого повідомлення по частинах
async function sendLargeMessage(ctx, messages) {
	try {
		for (const message of messages) {
			await ctx.api.sendMessage(ctx.chat.id, message, {
				parse_mode: 'Markdown',
			}) // Використовуємо ctx.api.sendMessage
			await new Promise(resolve => setTimeout(resolve, 100)) // Додаємо затримку між відправками (за потреби)
		}
	} catch (error) {
		logger.error('Error sending large message', error)
	}
}

// Команда /subscribe
bot.command('subscribe', async ctx => {
	try {
		const rssUrlsSnapshot = await db.collection('rssFeeds').get()
		if (rssUrlsSnapshot.empty) {
			return ctx.reply('No sources found. Add one using /addsource')
		}

		const rssUrls = rssUrlsSnapshot.docs.map(doc => doc.data().url)

		const allNews = []

		for (const rssUrl of rssUrls) {
			try {
				const news = await getNews(rssUrl)
				allNews.push(...news)
			} catch (error) {
				logger.error(`Error getting news from ${rssUrl}`, error)
				ctx.reply(`❌ Failed to get news from ${rssUrl}.`)
			}
		}

		if (allNews.length === 0) {
			return ctx.reply('No new news about Ukraine available at the moment.')
		}

		let response = '📰 Latest news about Ukraine:\n'
		let newsCount = 0
		const newsMessages = []

		// Обмежуємо кількість новин та розбиваємо на повідомлення
		for (const item of allNews) {
			if (newsCount >= config.newsLimit) break

			try {
				if (item.title) {
					// logger.debug(`Processing news item with title: ${item.title}`)
					const translatedTitle = await translateWithDelay(item.title) // Переклад з затримкою
					// logger.debug(`Translated title: ${translatedTitle}`)
					const pubDate = item.pubDate
						? moment(item.pubDate).format('YYYY-MM-DD HH:mm')
						: ''

					response += `\n🔗 *${translatedTitle}*\n${item.link}\n${
						pubDate ? `Published on: ${pubDate}` : ''
					}\n`

					newsCount++

					if (newsCount % config.messagesPerChunk === 0) {
						newsMessages.push(response)
						response = ''
					}

					// Додаємо новину в Firestore
					await db.collection('sentNews').add({ title: item.title })
				} else {
					logger.warn('Skipping news item with undefined title...')
				}
			} catch (error) {
				logger.error(`Error processing or sending news: ${item.title}`, error)
			}
		}

		// Відправляємо залишок
		if (response) {
			newsMessages.push(response)
		}

		await sendLargeMessage(ctx, newsMessages)
	} catch (error) {
		logger.error('Error in /subscribe command', error)
		ctx.reply('❌ Failed to retrieve news. Please try again later.')
	}
})

bot.command('ai', async ctx => {
	await ctx.reply('🤖 Summarizing your text...')
	await ctx.react('👍')
	try {
		const botText = await processRequest(ctx.message.text)
		await ctx.reply(botText)
	} catch (error) {
		logger.error('Text processing error:', error)
		await ctx.reply('Сталася помилка при обробці запиту')
	}
})

// Обробка помилок
bot.catch(err => {
	const ctx = err.ctx
	logger.error(
		`Error while handling update ${ctx.update.update_id}:`,
		err.error
	)
	const e = err.error
	if (e instanceof GrammyError) {
		logger.error('Error in request:', e.description)
	} else if (e instanceof HttpError) {
		logger.error('Could not contact Telegram:', e)
	} else {
		logger.error('Unknown error:', e)
	}
})

// Запуск бота
bot.start()
