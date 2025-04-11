import axios from 'axios'
import 'dotenv/config'
import config from '../config/config.js'

const API_URL = 'https://api.intelligence.io.solutions/api/v1/chat/completions'

const headers = {
	'Content-Type': 'application/json',
	Authorization: `Bearer ${config.aiToken}`,
}

// Головна функція для взаємодії з AI
export const processRequest = async (
	userInput,
	model = 'deepseek-ai/DeepSeek-R1'
) => {
	try {
		const data = {
			model,
			messages: [
				{
					role: 'system',
					content:
						'    Translate the headline into Ukrainian (if possible without losing meaning). Summarize the content concisely in Ukrainian (4-6 sentences), focusing on: Key events/quotes, Important numbers/dates, Main stakeholders. Keep organization names in their original form (e.g., NATO). Add the article link at the end without brackets or formatting from the new paragraph. Now is 2025 year. Dont send text like "**Переклад заголовка:**", "**Суть статті:**" or "**Короткий зміст:** ".',
				},
				{ role: 'user', content: userInput },
			],
		}

		const response = await axios.post(API_URL, data, { headers })
		return processResponse(response.data)
	} catch (error) {
		handleApiError(error)
		throw error
	}
}

// Обробка зображень
export const processImage = async (
	imageUrl,
	model = 'meta-llama/Llama-3.2-90B-Vision-Instruct'
) => {
	try {
		const data = {
			model,
			messages: [
				{ role: 'system', content: "You're an AI assistant" },
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'What is in this image?' },
						{ type: 'image_url', image_url: { url: imageUrl } },
					],
				},
			],
		}

		const response = await axios.post(API_URL, data, { headers })
		return processResponse(response.data)
	} catch (error) {
		handleApiError(error)
		throw error
	}
}

// Уніфікована обробка відповіді
const processResponse = responseData => {
	if (!responseData.choices || !responseData.choices[0]) {
		throw new Error('Invalid API response structure')
	}

	const fullResponse = responseData.choices[0].message.content
	return fullResponse.split('</think>\n\n')[1] || fullResponse
}

// Обробка помилок API
const handleApiError = error => {
	console.error('API Error:', error.response?.data || error.message)
	throw new Error(
		error.response?.data?.error?.message || 'Failed to process request'
	)
}

// import 'dotenv/config'

// const options = {
// 	method: 'POST',
// 	headers: {
// 		accept: 'application/json',
// 		Authorization: `Bearer ${process.env.AI_TOKEN}`,
// 		type: 'application/json',
// 	},
// }
// const url = 'https://api.intelligence.io.solutions/api/v1/chat/completions'

// fetch(url, options)
// 	.then(res => res.json())
// 	.then(json => console.log(json))
// 	.catch(err => console.error(err))

// const url = 'https://api.intelligence.io.solutions/api/v1/models'

// fetch(url, options)
// 	.then(res => res.json())
// 	.then(res => {
// 		const dataArray = res.data
// 		if (Array.isArray(dataArray)) {
// 			const ids = dataArray.map(item => item.id)
// 			console.log(ids)
// 		} else {
// 			console.error('Format error:', dataArray)
// 		}
// 	})
// 	.catch(err => console.error(err))
