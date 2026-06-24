import { Navigate, Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { RunBanner } from './components/RunBanner'
import { RegenBanner } from './components/RegenBanner'
import { CartBar } from './components/CartBar'
import { Dashboard } from './screens/Dashboard'
import { TranscriptReview } from './screens/TranscriptReview'
import { TranslationReview } from './screens/TranslationReview'
import { Workbench } from './screens/Workbench'
import { RenderStep } from './screens/RenderStep'
import { Qa } from './screens/Qa'
import { Voices } from './screens/Voices'
import { Config } from './screens/Config'
import { Prompts } from './screens/Prompts'
import { TuningLab } from './screens/TuningLab'
import { SetupErrorScreen } from './screens/SetupError'

export default function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <RunBanner />
        <RegenBanner />
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<Dashboard />} />
            <Route path="/lesson" element={<Navigate to="/projects" replace />} />
            <Route path="/transcript" element={<TranscriptReview />} />
            <Route path="/translation" element={<TranslationReview />} />
            <Route path="/review" element={<Workbench />} />
            <Route path="/render" element={<RenderStep />} />
            <Route path="/qa" element={<Qa />} />
            <Route path="/voices" element={<Voices />} />
            <Route path="/prompts" element={<Prompts />} />
            <Route path="/cps" element={<TuningLab />} />
            <Route path="/config" element={<Config />} />
            <Route path="/setup" element={<SetupErrorScreen />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </main>
        <CartBar />
      </div>
    </div>
  )
}
