import React, { useState } from 'react'
import Step14 from './Step14'
import Step10 from './Step10'
import StepChipmunk from './StepChipmunk' // Import the new component

function App() {
  const [currentStep, setCurrentStep] = useState<'chipmunk' | '10' | '14'>('chipmunk'); // Default to Chipmunk

  return (
    <div className="App min-h-screen bg-gray-50">
      <div className="bg-white border-b sticky top-0 z-50 px-4 py-3 shadow-sm mb-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
            <h1 className="font-bold text-gray-700 hidden sm:block">Voice Changer Playground</h1>
            <div className="flex bg-gray-100 rounded-lg p-1 gap-1 overflow-x-auto">
                 <button 
                    onClick={() => setCurrentStep('chipmunk')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
                        currentStep === 'chipmunk' 
                        ? 'bg-white text-blue-600 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Chipmunk (Speed)
                </button>
                <button 
                    onClick={() => setCurrentStep('10')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
                        currentStep === '10' 
                        ? 'bg-white text-indigo-600 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    LPC Only (Robotic)
                </button>
                <button 
                    onClick={() => setCurrentStep('14')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
                        currentStep === '14' 
                        ? 'bg-white text-teal-600 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    LPC Advanced (Organic)
                </button>
            </div>
        </div>
      </div>
      
      <div className="container mx-auto">
        {currentStep === 'chipmunk' && <StepChipmunk />}
        {currentStep === '10' && <Step10 />}
        {currentStep === '14' && <Step14 />}
      </div>
    </div>
  )
}

export default App
