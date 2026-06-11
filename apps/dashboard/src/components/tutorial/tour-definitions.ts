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
    title: "Panel de Control — Santo AI OS",
    content:
      "Este es el centro de operaciones de Santo. Desde aquí se monitorea todo lo que pasa: ventas, conciliaciones, excepciones y aprobaciones. El badge muestra si estás en modo demo o en operación real.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="hero"]',
    title: "¿Qué es esto?",
    content:
      "Este panel explica el flujo completo que Santo AI OS maneja automáticamente: recibir emails con documentos, clasificarlos, ejecutar el workflow correcto, guardar la evidencia y pedir revisión humana cuando hay dudas.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="metrics"]',
    title: "Métricas Clave",
    content:
      "Estos 4 indicadores resumen el estado del sistema en un vistazo: cuántos workflows están listos, cuántos documentos se han trazado, cuántas cosas necesitan revisión humana, y cuántas integraciones están activas.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="workflows"]',
    title: "Los 3 Workflows de P0",
    content:
      "Estos son los tres procesos que se automatizan en la primera fase: Corte Santo (conciliación diaria), XML SAT (validación de facturas CFDI), y Recibos de servicios (registro de pagos CFE, agua, gas). Cada uno genera evidencia trazable y pide revisión cuando algo no cuadra.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: '[data-tour="timeline"]',
    title: "Así Funciona un Corte Santo",
    content:
      "Esta línea de tiempo muestra paso a paso cómo se procesa un cierre diario: llega un email → Agent Mail lo clasifica → el workflow valida y registra → la evidencia se prepara para Drive → se pide revisión humana. Los pasos en verde están listos; los ámbar esperan configuración.",
    placement: "left",
    skipBeacon: true,
  },
  {
    target: '[data-tour="decisions"]',
    title: "⚠️ Lo Que Falta Para Cerrar P0",
    content:
      "Esta es la lista de decisiones que necesitamos para terminar. Cada círculo vacío es algo pendiente: carpetas de Drive, datos del restaurante/RFC, documentos obligatorios, tolerancias de diferencias, responsables de excepciones, y formato de emails. Hasta que se confirmen, el sistema no opera en producción.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: '[data-tour="principles"]',
    title: "Los Principios del Sistema",
    content:
      "Santo AI OS tiene 4 reglas inquebrantables: una sola memoria (Supabase registra TODO), Drive solo guarda archivos (no decisiones), siempre pide revisión humana ante la duda, y repetir una operación nunca duplica datos.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: '[data-tour="nav-reviews"]',
    title: "Revisiones Humanas",
    content:
      "Aquí es donde Olivia (o quien sea responsable) revisa y aprueba las operaciones que necesitan decisión humana. Puedes aprobar, pedir corrección, o resolver excepciones.",
    placement: "right",
    skipBeacon: true,
  },
  {
    target: '[data-tour="help-button"]',
    title: "¿Necesitas ayuda después?",
    content:
      "Siempre puedes repetir este tour desde aquí. También encontrarás íconos de ayuda (?) junto a los elementos más importantes del dashboard.",
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
    title: "Panel de Operaciones Reales",
    content:
      "Estás viendo datos reales de Supabase. Todo lo que aparece aquí son operaciones que el sistema ha procesado. El badge verde de 'Operación' confirma que estás en modo producción.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="metrics"]',
    title: "Métricas en Tiempo Real",
    content:
      "Estos indicadores se actualizan con cada operación: Operaciones (total de runs registrados), Necesitan revisión (esperan tu decisión), Revisiones (cola de aprobaciones), y Emails (procesados por Agent Mail).",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="operations"]',
    title: "Operaciones Recientes",
    content:
      "Esta tabla muestra las últimas operaciones con su fecha, canal de origen, estado y motivo de bloqueo. Los colores indican: verde = completado, ámbar = necesita revisión, rojo = error.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: '[data-tour="exceptions"]',
    title: "Excepciones Detectadas",
    content:
      "Aquí aparecen los problemas que el sistema detectó automáticamente: diferencias de caja, documentos faltantes, emails no reconocidos, etc.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: '[data-tour="agent-mail"]',
    title: "Agent Mail — Emails Procesados",
    content:
      "Agent Mail es el buzón inteligente del sistema. Recibe emails, los clasifica automáticamente y los vincula al workflow correcto. Si no puede clasificar algo, lo marca como 'necesita revisión'.",
    placement: "top",
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
    title: "Operaciones Esperando Tu Decisión",
    content:
      "Estas son operaciones que el sistema procesó pero NO completó automáticamente. Ninguna operación incierta se marca como completada — siempre se pide revisión humana.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="approve-action"]',
    title: "Aprobar una Operación",
    content:
      "Al hacer click en 'Aprobar', confirmas que revisaste la información y todo está correcto. Se registra tu nombre, fecha y hora como auditoría.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="correction-action"]',
    title: "Pedir Corrección",
    content:
      "Si algo no está bien, escribe una nota explicando qué falta o qué está mal, y se enviará un email al remitente original pidiendo corrección.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="exceptions-detected"]',
    title: "Problemas Detectados Automáticamente",
    content:
      "El sistema detecta problemas como diferencias de caja, documentos faltantes, o emails no reconocidos. Puedes marcarlos como resueltos cuando los hayas atendido.",
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
