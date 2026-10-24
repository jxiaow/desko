export const reasoningLabels: Record<string, string> = { none: '不思考', minimal: '最少思考', low: '轻量思考', medium: '标准思考', high: '深入思考', xhigh: '更深入思考', max: '最高思考', ultra: '极高思考' }
export const reasoningLabel = (effort: string) => reasoningLabels[effort] || effort
