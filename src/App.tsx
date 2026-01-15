import React, { useState } from 'react'
import Step14 from './Step14'
import Step10 from './Step10'

function App() {
  const [currentStep, setCurrentStep] = useState<'10' | '14'>('10');

  return (
    <div className="App min-h-screen bg-gray-50">
      <div className="bg-white border-b sticky top-0 z-50 px-4 py-3 shadow-sm mb-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
            <h1 className="font-bold text-gray-700">Voice Changer Playground</h1>
            <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
                <button 
                    onClick={() => setCurrentStep('10')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                        currentStep === '10' 
                        ? 'bg-white text-indigo-600 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Step 10
                </button>
                <button 
                    onClick={() => setCurrentStep('14')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                        currentStep === '14' 
                        ? 'bg-white text-indigo-600 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Step 14
                </button>
            </div>
        </div>
      </div>
      
      <div className="container mx-auto">
        {currentStep === '10' ? <Step10 /> : <Step14 />}
      </div>
    </div>
  )
}

export default App
