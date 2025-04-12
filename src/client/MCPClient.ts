import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import readline from 'readline/promises'
import * as fs from 'fs'

import dotenv from 'dotenv'
import { MessageParam, Tool } from '@anthropic-ai/sdk/resources/index.mjs'
dotenv.config()

const GROK_API_KEY = process.env.GROK_API_KEY
if (!GROK_API_KEY) throw new Error('GROK_API_KEY is not set')

interface Config {
  mcpServers: Record<string, MCPServer>
}

interface MCPServer {
  command: string
  args: string[]
  env?: Record<string, string>
}

class MCPClient {
  private mcp: Client
  private anthropic: Anthropic
  private transports: Map<string, StdioClientTransport> = new Map()
  private tools: Tool[] = []
  private toolNameMapping: Map<string, string> = new Map()
  private config!: Config

  private constructor() {
    this.anthropic = new Anthropic({
      baseURL: 'https://api.x.ai',
      apiKey: GROK_API_KEY,
    })
    this.mcp = new Client({ name: 'mcp-client-template', version: '1.0.0' })
    this.config = this.loadConfig()
  }

  private static instance: MCPClient
  public static getInstance(): MCPClient {
    if (!MCPClient.instance) {
      MCPClient.instance = new MCPClient()
    }
    return MCPClient.instance
  }

  public async connectToServers() {
    const serverPromises = Object.entries(this.config.mcpServers).map(([serverName, server]) => this.connectToServer(serverName, server))
    await Promise.all(serverPromises)
  }

  public async prompt(message: string) {
    return this.processQuery(message)
  }

  public async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    try {
      console.log('\nMCP Client Started!')
      console.log("Type your queries or 'quit' to exit.")

      while (true) {
        const message = await rl.question('\nQuery: ')
        if (message.toLowerCase() === 'quit') {
          break
        }
        const response = await this.processQuery(message)
        console.log('\n' + response)
      }
    } catch (e) {
      console.log('Error:', e)
    } finally {
      rl.close()
    }
  }

  public async cleanup() {
    await this.mcp.close()
  }

  private loadConfig(): Config {
    const configPath = './config.json'
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8')
      return JSON.parse(configContent) as Config
    } catch (error) {
      console.error('Failed to load config.json:', error)
      throw new Error('Config file is required')
    }
  }

  private async processQuery(query: string) {
    const messages: MessageParam[] = [
      {
        role: 'user',
        content: query,
      },
    ]

    const response = await this.anthropic.messages.create({
      model: 'grok-3-fast-latest',
      max_tokens: 1000,
      messages,
      tools: this.tools,
    })

    const finalText = []
    const toolResults = []

    for (const content of response.content) {
      if (content.type === 'text') {
        finalText.push(content.text)
      } else if (content.type === 'tool_use') {
        const toolName = content.name
        const originalToolName = this.toolNameMapping.get(toolName)!
        const toolArgs = content.input as { [x: string]: unknown } | undefined

        const result = await this.mcp.callTool({
          name: originalToolName,
          arguments: toolArgs,
        })
        toolResults.push(result)
        finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`)

        messages.push({
          role: 'user',
          content: result.content as string,
        })

        const response = await this.anthropic.messages.create({
          model: 'grok-3-fast-latest',
          max_tokens: 1000,
          messages,
        })

        finalText.push(response.content[0].type === 'text' ? response.content[0].text : '')
      }
    }

    return finalText.join('\n')
  }

  private async connectToServer(serverName: string, server: MCPServer) {
    try {
      const scriptPath = server.args[0]
      const isPy = scriptPath.endsWith('.py')

      const command = server.command || (isPy ? (process.platform === 'win32' ? 'python' : 'python3') : process.execPath)

      const transport = new StdioClientTransport({
        command,
        args: server.args,
        env: server.env,
      })

      this.transports.set(serverName, transport)
      this.mcp.connect(transport)

      const toolsResult = await this.mcp.listTools()
      const serverTools = toolsResult.tools.map((tool) => {
        const prefixedName = `${serverName}_${tool.name}`
        this.toolNameMapping.set(prefixedName, tool.name)
        return {
          name: `${serverName}_${tool.name}`,
          description: tool.description,
          input_schema: tool.inputSchema,
        }
      })

      this.tools.push(...serverTools)
      console.log(
        `Connected to ${serverName} with tools:`,
        serverTools.map((tool) => tool.name)
      )
    } catch (e) {
      console.error(`Failed to connect to ${serverName}:`, e)
      throw e
    }
  }
}

const client = MCPClient.getInstance()
Object.freeze(client)
export default client
