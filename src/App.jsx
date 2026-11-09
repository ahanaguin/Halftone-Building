import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DesktopGate } from './DesktopGate.jsx'
import { Calibrate } from './Calibrate.jsx'
import { Export } from './Export.jsx'
import { IntroLockProvider, StepGate } from './StepIntro.jsx'
import { Shell } from './Shell.jsx'
import { HowItWorks, Landing, MyPalette, PickStyle, SendFeedback } from './screens.jsx'
import { MyVisuals } from './MyVisuals.jsx'
import { Studio } from './Studio.jsx'
import { TrackProvider } from './track.jsx'
import { Upload } from './Upload.jsx'
import { VisualSessionProvider } from './visualSession.jsx'
import { useNarrow } from './useNarrow.js'

export default function App() {
  const narrow = useNarrow()

  return (
    <TrackProvider>
      {narrow ? (
        <DesktopGate />
      ) : (
        <VisualSessionProvider>
          <BrowserRouter>
            <IntroLockProvider>
              <Routes>
                <Route element={<Shell />}>
                  <Route index element={<Landing />} />
                  <Route path="calibrate" element={<Calibrate />} />
                  <Route path="upload" element={<StepGate id="upload"><Upload /></StepGate>} />
                  <Route path="pick-a-style" element={<StepGate id="style"><PickStyle /></StepGate>} />
                  <Route path="studio" element={<StepGate id="studio"><Studio /></StepGate>} />
                  <Route path="export" element={<Export />} />
                  <Route path="visuals" element={<MyVisuals />} />
                  <Route path="palette" element={<MyPalette />} />
                  <Route path="how-it-works" element={<HowItWorks />} />
                  <Route path="feedback" element={<SendFeedback />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </IntroLockProvider>
          </BrowserRouter>
        </VisualSessionProvider>
      )}
    </TrackProvider>
  )
}
