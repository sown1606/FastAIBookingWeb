export interface AIParseInput {
  prompt: string;
  taskType: string;
}

export interface AIParseOutput {
  model: string;
  responseText: string;
  rawResponse: unknown;
}

export interface AIProviderAdapter {
  parse(input: AIParseInput): Promise<AIParseOutput>;
}
