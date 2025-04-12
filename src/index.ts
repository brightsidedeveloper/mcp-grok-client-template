import client from './client/MCPClient.js'
import { Context, Hono } from 'hono'
import { serve } from '@hono/node-server'
import { sleep } from '@anthropic-ai/sdk/core.mjs'

const app = new Hono()

const apiKeyMiddleware = async (c: Context, next: () => Promise<void>) => {
  const apiKey: string | undefined = c.req.header('X-API-Key')
  const validApiKey = 'tim'

  if (!apiKey || apiKey !== validApiKey) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Valid API key required',
      },
      401
    )
  }
  await next()
}

app.use('*', apiKeyMiddleware)

app.post('/api/prompt', async (c) => {
  const body = await c.req.json()
  console.log(body)
  const response = await client.prompt(body.message)

  return c.json(response)
})

app.onError((err, c) => {
  console.error(err)
  return c.json(
    {
      error: 'Internal Server Error',
      message: 'Something went wrong',
    },
    500
  )
})

const port = 3000

async function main() {
  await client.connectToServers()
  const server = serve(
    {
      fetch: app.fetch,
      port: port,
    },
    () => {
      console.log(`Server running on http://localhost:${port}`)
    }
  )

  await sleep(100_000_000)
}

main()
