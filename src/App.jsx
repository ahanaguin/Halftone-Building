import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DesktopGate } from './DesktopGate.jsx'
import { Shell } from './Shell.jsx'
import {
  Calibrate,
  Export,
  HowItWorks,
  Landing,
  MyPalette,
  MyVisuals,
  PickStyle,
  SendFeedback,
} from './screens.jsx'
import { Studio } from './Studio.jsx'
import { TrackProvider } from './track.jsx'
import { Upload } from './Upload.jsx'
import { useNarrow } from './useNarrow.js'

export default function App() {
  const narrow = useNarrow()

  return (
    <TrackProvider>
      {narrow ? (
        <DesktopGate />
      ) : (
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Landing />} />
              <Route path="calibrate" element={<Calibrate />} />
              <Route path="upload" element={<Upload />} />
              <Route path="pick-a-style" element={<PickStyle />} />
              <Route path="studio" element={<Studio />} />
              <Route path="export" element={<Export />} />
              <Route path="visuals" element={<MyVisuals />} />
              <Route path="palette" element={<MyPalette />} />
              <Route path="how-it-works" element={<HowItWorks />} />
              <Route path="feedback" element={<SendFeedback />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      )}
    </TrackProvider>
  )
}
