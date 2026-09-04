"use client"

import { useState } from "react"
import { Check, Copy, Lock, X } from "lucide-react"

interface OneTimePasswordNoticeProps {
  kind: "file" | "album"
  password: string
  onClose: () => void
}

export default function OneTimePasswordNotice({ kind, password, onClose }: OneTimePasswordNoticeProps) {
  const [copied, setCopied] = useState(false)

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[90]">
      <div className="glass-card p-6 max-w-md w-full">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary-400" />
              Save this password now
            </h3>
            <p className="text-sm text-dark-400 mt-2">
              This {kind} password is shown once. It is not displayed again later.
            </p>
          </div>
          <button onClick={onClose} className="text-dark-400 hover:text-white p-1" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-primary-500/30 bg-primary-500/10 p-3">
          <code className="text-white break-all flex-1">{password}</code>
          <button onClick={copyPassword} className="btn-secondary shrink-0 flex items-center gap-1.5" title="Copy password">
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
        <button onClick={onClose} className="btn-primary w-full mt-4">I saved it</button>
      </div>
    </div>
  )
}
