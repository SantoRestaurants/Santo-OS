/**
 * Tour step definitions for SantoOS guided walkthrough.
 * Each tour is a sequence of steps that highlight elements via data-tour attributes.
 * All text is in Spanish — target users are Spanish speakers.
 *
 * Uses react-joyride v3 API.
 */

import type { Locale, Step } from "react-joyride";

/* ------------------------------------------------------------------ */
/*  HOME / DEMO TOUR                                                  */
/*  Shown when the client opens the dashboard in demo mode            */
/* ------------------------------------------------------------------ */

export const homeDemoTour: Step[] = [
  {
    target: '[data-tour="header"]',
    title: "Tu panel",
    content:
      "Este es tu panel de Santo. Aquí ves los cortes del día y lo que necesita tu revisión. Nada más — todo lo técnico pasa por detrás.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="needs-decision"]',
    title: "Lo que necesita tu revisión",
    content:
      "Cuando un corte necesita que tú lo apruebes, aparece aquí arriba. Si está en verde, no tienes nada pendiente.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="cortes"]',
    title: "Cortes recientes",
    content:
      "Esta lista muestra los últimos cortes con su fecha y en qué estado están, explicado en palabras simples.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: '[data-tour="nav-reviews"]',
    title: "Mis pendientes",
    content:
      "Aquí entras a revisar y aprobar. El sistema nunca cierra un corte solo si hay dudas: siempre te pregunta primero.",
    placement: "right",
    skipBeacon: true,
  },
  {
    target: '[data-tour="help-button"]',
    title: "¿Necesitas ayuda?",
    content:
      "Puedes repetir esta guía cuando quieras tocando este botón.",
    placement: "right",
    skipBeacon: true,
  },
];

/* ------------------------------------------------------------------ */
/*  HOME / LIVE TOUR                                                  */
/*  Shown when using the live dashboard with real data                */
/* ------------------------------------------------------------------ */

export const homeLiveTour: Step[] = [
  {
    target: '[data-tour="header"]',
    title: "Tu panel",
    content:
      "Aquí ves los cortes del día y lo que necesita tu revisión. Está pensado para que de un vistazo sepas qué hacer.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="needs-decision"]',
    title: "Lo que necesita tu revisión",
    content:
      "Si hay cortes esperando tu aprobación, aparecen aquí. Toca para revisarlos. Si está en verde, estás al día.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="cortes"]',
    title: "Cortes recientes",
    content:
      "Los últimos cortes con su fecha y estado. 'Aprobado' ya quedó; 'Necesita revisión' espera por ti.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: '[data-tour="nav-reviews"]',
    title: "Mis pendientes",
    content:
      "Entra aquí para aprobar cortes o pedir una corrección cuando algo falta.",
    placement: "right",
    skipBeacon: true,
  },
];

/* ------------------------------------------------------------------ */
/*  REVIEWS TOUR                                                      */
/*  Shown on the /reviews page                                       */
/* ------------------------------------------------------------------ */

export const reviewsTour: Step[] = [
  {
    target: '[data-tour="pending-reviews"]',
    title: "Lo que espera tu decisión",
    content:
      "Estos cortes el sistema los procesó pero no los cerró solo. Cuando hay dudas, siempre te pregunta a ti antes de continuar.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="approve-action"]',
    title: "Aprobar",
    content:
      "Si revisaste y todo está bien, toca Aprobar. Queda registrado tu nombre y la fecha.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="correction-action"]',
    title: "Pedir corrección",
    content:
      "Si algo falta o está mal, escribe una nota corta (por ejemplo: 'falta el voucher del banco') y se le avisa a quien envió el corte.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="exceptions-detected"]',
    title: "Problemas detectados",
    content:
      "El sistema marca aquí cosas como diferencias en las cuentas o documentos faltantes. Cuando los atiendas, márcalos como resueltos.",
    placement: "top",
    skipBeacon: true,
  },
];

/* ------------------------------------------------------------------ */
/*  TOUR LOCALE (Spanish)                                             */
/* ------------------------------------------------------------------ */

export const TOUR_LOCALE: Locale = {
  back: "← Anterior",
  close: "Cerrar",
  last: "¡Listo!",
  next: "Siguiente →",
  nextWithProgress: "Siguiente ({current}/{total}) →",
  open: "Abrir",
  skip: "Saltar tour",
};
