import { Outlet, useMatch } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Navbar from './Navbar'

const ChatBot = lazy(() => import('./chatbot/ChatBot').then((m) => ({ default: m.ChatBot })))

export default function AuthenticatedLayout() {
  const caseRouteMatch = useMatch('/case/:id')
  const caseModuleRouteMatch = useMatch('/case/:id/:dataType')
  const activeCaseId = caseModuleRouteMatch?.params.id || caseRouteMatch?.params.id || null
  const activeCaseType = caseModuleRouteMatch?.params.dataType || null

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none fixed left-[-8rem] top-28 h-72 w-72 rounded-full bg-blue-400/8 blur-3xl" />
      <div className="pointer-events-none fixed bottom-10 right-[-10rem] h-96 w-96 rounded-full bg-shakti-600/12 blur-3xl" />

      <Navbar />

      <main className="relative mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <Suspense fallback={null}>
        <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end sm:bottom-6 sm:right-6">
          <ChatBot caseId={activeCaseId} caseType={activeCaseType} />
        </div>
      </Suspense>
    </div>
  )
}
