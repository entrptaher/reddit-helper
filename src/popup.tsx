import React, { useEffect, useState } from "react"
import { loadSettings, saveSettings } from "./lib/storage"

import "./popup.css"

function Popup() {
  const [enabled, setEnabled] = useState(true)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    loadSettings().then((s) => {
      setEnabled(s.enabled)
      setLoaded(true)
    })
  }, [])

  const toggle = async () => {
    const next = !enabled
    setEnabled(next)
    const s = await loadSettings()
    await saveSettings({ ...s, enabled: next })
  }

  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  if (!loaded) return null

  return (
    <div className="popup-root">
      <div className="popup-row">
        <span className="popup-label">Summarizer</span>
        <button
          className={`popup-toggle ${enabled ? "on" : "off"}`}
          onClick={toggle}
          aria-label={enabled ? "Disable summarizer" : "Enable summarizer"}
        >
          <span className="popup-toggle-thumb" />
        </button>
      </div>
      <button className="popup-options-btn" onClick={openOptions}>
        Open Options
      </button>
    </div>
  )
}

export default Popup
