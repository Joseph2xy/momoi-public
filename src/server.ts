import handler from '@tanstack/react-start/server-entry'

export default {
  fetch(request) {
    return handler.fetch(request)
  },
} satisfies ExportedHandler
