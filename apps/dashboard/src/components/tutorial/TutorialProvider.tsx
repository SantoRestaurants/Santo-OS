"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Step } from "react-joyride";
import {
  homeDemoTour,
  homeLiveTour,
  reviewsTour,
  TOUR_LOCALE,
} from "@/components/tutorial/tour-definitions";

// Dynamic import to avoid SSR issues — react-joyride needs the DOM
const Joyride = dynamic(() => import("react-joyride").then(m => m.Joyride), {
  ssr: false,
});

/* ------------------------------------------------------------------ */
/*  Context                                                           */
/* ------------------------------------------------------------------ */

interface TutorialContextValue {
  startTour: (tourId: string) => void;
  isActive: boolean;
}

const TutorialContext = createContext<TutorialContextValue>({
  startTour: () => {},
  isActive: false,
});

export const useTutorial = () => useContext(TutorialContext);

/* ------------------------------------------------------------------ */
/*  Storage helpers                                                   */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "santo_tours_completed";
const WELCOME_KEY = "santo_welcome_seen";

function getCompletedTours(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function markTourCompleted(tourId: string) {
  const completed = getCompletedTours();
  if (!completed.includes(tourId)) {
    completed.push(tourId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
  }
}

function wasWelcomeSeen(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(WELCOME_KEY) === "true";
}

function markWelcomeSeen() {
  localStorage.setItem(WELCOME_KEY, "true");
}

/* ------------------------------------------------------------------ */
/*  Tour map                                                          */
/* ------------------------------------------------------------------ */

const TOURS: Record<string, Step[]> = {
  "home-demo": homeDemoTour,
  "home-live": homeLiveTour,
  reviews: reviewsTour,
};

/* ------------------------------------------------------------------ */
/*  Welcome Modal                                                     */
/* ------------------------------------------------------------------ */

function WelcomeModal({
  onStartTour,
  onSkip,
}: {
  onStartTour: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-stone-950/50 p-4">
      <div className="w-full max-w-md animate-[fadeIn_0.3s_ease-out] rounded-2xl border border-stone-200 bg-white p-8 shadow-2xl">
        {/* Icon */}
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-stone-950 text-white">
          <svg
            className="h-8 w-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
            />
          </svg>
        </div>

        {/* Title */}
        <h2 className="text-center text-xl font-bold text-stone-950">
          Bienvenido a Santo AI OS
        </h2>
        <p className="mt-3 text-center text-sm leading-6 text-stone-600">
          Este es el sistema operativo inteligente de Santo. Automatiza la
          conciliación diaria, valida documentos fiscales y mantiene trazabilidad
          completa de cada operación — con revisión humana siempre que hay dudas.
        </p>

        {/* What we'll show */}
        <div className="mt-6 rounded-xl border border-stone-100 bg-stone-50 p-4">
          <p className="text-xs font-semibold text-stone-700">
            En el tour te mostraremos:
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-stone-600">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-emerald-500">●</span>
              Cómo funciona el flujo completo de operaciones
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-sky-500">●</span>
              Qué hace cada sección del dashboard
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-500">●</span>
              Qué falta confirmar para activar la operación real
            </li>
          </ul>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={onStartTour}
            className="w-full rounded-xl bg-stone-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
            type="button"
          >
            🚀 Iniciar Tour Guiado
          </button>
          <button
            onClick={onSkip}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-800"
            type="button"
          >
            Explorar por mi cuenta
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider Component                                                */
/* ------------------------------------------------------------------ */

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [showWelcome, setShowWelcome] = useState(false);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [run, setRun] = useState(false);

  // Show welcome modal on first visit (delay to let the page render)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!wasWelcomeSeen()) {
        setShowWelcome(true);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // Listen for restart-tour custom event from sidebar help button
  useEffect(() => {
    function handleRestart() {
      const isReviews = window.location.pathname.includes("/reviews");

      if (isReviews) {
        startTour("reviews");
      } else {
        startTour("home-live");
      }
    }
    window.addEventListener("santo:restart-tour", handleRestart);
    return () =>
      window.removeEventListener("santo:restart-tour", handleRestart);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startTour = useCallback((tourId: string) => {
    const tourSteps = TOURS[tourId];
    if (!tourSteps) return;
    setShowWelcome(false);
    markWelcomeSeen();
    setActiveTourId(tourId);
    setSteps(tourSteps);
    setRun(false);
    // Small delay so Joyride can remount with new steps
    setTimeout(() => setRun(true), 150);
  }, []);

  function handleWelcomeStartTour() {
    startTour("home-live");
  }

  function handleWelcomeSkip() {
    setShowWelcome(false);
    markWelcomeSeen();
  }

  const contextValue: TutorialContextValue = {
    startTour,
    isActive: run,
  };

  return (
    <TutorialContext.Provider value={contextValue}>
      {children}
      {showWelcome && (
        <WelcomeModal
          onStartTour={handleWelcomeStartTour}
          onSkip={handleWelcomeSkip}
        />
      )}
      {steps.length > 0 && (
        <Joyride
          steps={steps}
          run={run}
          continuous
          scrollToFirstStep
          locale={TOUR_LOCALE}
          onEvent={(data) => {
            const { action, status } = data;
            if (status === "finished" || status === "skipped") {
              setRun(false);
              if (status === "finished" && activeTourId) {
                markTourCompleted(activeTourId);
              }
              setActiveTourId(null);
            }
            if (action === "close") {
              setRun(false);
              setActiveTourId(null);
            }
          }}
          options={{
            showProgress: true,
            overlayColor: "rgba(28, 25, 23, 0.65)",
            primaryColor: "#1c1917",
            textColor: "#57534e",
            backgroundColor: "#ffffff",
            overlayClickAction: false,
            buttons: ["back", "primary", "skip"],
            spotlightRadius: 16,
            zIndex: 10000,
          }}
          styles={{
            tooltip: { borderRadius: 16, padding: 20 },
            tooltipContainer: { textAlign: "left" },
            tooltipTitle: {
              fontSize: 15,
              fontWeight: 600,
              color: "#1c1917",
              marginBottom: 8,
            },
            tooltipContent: {
              fontSize: 13,
              lineHeight: 1.6,
              color: "#57534e",
            },
            buttonPrimary: {
              backgroundColor: "#1c1917",
              borderRadius: 10,
              color: "#ffffff",
              fontSize: 13,
              fontWeight: 600,
              padding: "8px 18px",
            },
            buttonBack: {
              color: "#78716c",
              fontSize: 13,
              fontWeight: 500,
              marginRight: 8,
            },
            buttonSkip: {
              color: "#a8a29e",
              fontSize: 12,
            },
            buttonClose: {
              display: "none",
            },
          }}
        />
      )}
    </TutorialContext.Provider>
  );
}
