import { Outlet } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Navbar from './Navbar'
import { useCaseContextStore } from '../stores/caseContextStore'

const ChatBot = lazy(() => import('./chatbot/ChatBot').then((m) => ({ default: m.ChatBot })))

export default function AuthenticatedLayout() {
  const activeCase = useCaseContextStore((state) => state.activeCase)

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
          <ChatBot caseId={activeCase?.id || null} caseType={activeCase?.caseType || null} />
        </div>
      </Suspense>
    </div>
  )
}
