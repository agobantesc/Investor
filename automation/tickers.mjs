// Universo IPSA (~30). Clave = ticker en Investor, valor = símbolo Yahoo Finance (.SN = Bolsa de Santiago).
// Lo comparten fetch-closes.mjs (cierres diarios) y fetch-fundamentals.mjs (P/U, P/B, dividendos, capitalización):
// si agregas o cambias una acción, se actualiza aquí UNA vez y ambos la toman.
export const TICKERS = {
  // núcleo (con historial demo en la app)
  CHILE: "CHILE.SN",
  SANTANDER: "BSANTANDER.SN",
  BCI: "BCI.SN",
  ENELCHILE: "ENELCHILE.SN",
  COLBUN: "COLBUN.SN",
  FALABELLA: "FALABELLA.SN",
  CENCOSUD: "CENCOSUD.SN",
  COPEC: "COPEC.SN",
  CMPC: "CMPC.SN",
  "SQM-B": "SQM-B.SN",
  CCU: "CCU.SN",
  ENTEL: "ENTEL.SN",
  LATAM: "LTM.SN",
  PARAUCO: "PARAUCO.SN",
  // resto del IPSA
  "AGUAS-A": "AGUAS-A.SN",
  IAM: "IAM.SN",
  ENELAM: "ENELAM.SN",
  ECL: "ECL.SN",
  "ANDINA-B": "ANDINA-B.SN",
  CONCHATORO: "CONCHATORO.SN",
  QUINENCO: "QUINENCO.SN",
  MALLPLAZA: "MALLPLAZA.SN",
  VAPORES: "VAPORES.SN",
  RIPLEY: "RIPLEY.SN",
  SMU: "SMU.SN",
  SONDA: "SONDA.SN",
  ITAUCL: "ITAUCL.SN",
  CAP: "CAP.SN",
  // Sin símbolo en Yahoo (404): BICECORP (ex Grupo Security) y CENCOSHOPP (Cencosud Shopping).
  // Siguen en el universo de la app; sus cierres se cargan por planilla si se consiguen.
};
