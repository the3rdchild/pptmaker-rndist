const request = async (url: string, options: RequestInit): Promise<Response> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const contentType = response.headers.get('content-type')
  const isStreamResponse = contentType && (
    contentType.includes('text/event-stream') ||
    contentType.includes('application/octet-stream')
  )

  if (!isStreamResponse) {
    try {
      const jsonResponse = await response.json()
      return jsonResponse
    } 
    catch (err) {
      throw new Error('The server returned a non-stream response')
    }
  }

  return response
}

export default request