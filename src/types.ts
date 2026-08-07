export type TripType = "oneway" | "roundtrip";

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface FlightRoute {
  id: string;
  userId: string;
  label: string;
  origin: string; // código IATA ou cidade, ex: "GRU"
  destination: string; // código IATA ou cidade, ex: "LIS"
  tripType: TripType;
  departDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD, obrigatório se tripType === "roundtrip"
  whatsappNumber?: string; // número que recebe o alerta dessa rota; sem isso usa o número padrão do .env
  combineStops?: boolean; // tenta achar voos separados (via aeroporto(s) próximo(s) do destino) mais baratos que o direto
  arriveBy?: string; // YYYY-MM-DD, data limite de chegada no destino (trecho de ida); se ausente, só considera conexão apertada (1h30-12h) no mesmo dia
  returnArriveBy?: string; // YYYY-MM-DD, data limite de chegada de volta na origem; só usado quando tripType === "roundtrip"
  tryThreeLegs?: boolean; // além de 1 conexão, também tenta 2 conexões via um hub de longo curso; bem mais lento
  createdAt: string;
}

export interface ComboLeg {
  from: string; // código IATA de origem do trecho
  to: string; // código IATA de destino do trecho
  price: number;
  currency: string;
  departAt: string; // ISO
  arriveAt: string; // ISO
  url: string;
}

export interface ComboResult {
  legs: ComboLeg[]; // 2 ou mais trechos, em ordem
  totalPrice: number;
  currency: string;
}

export interface PriceCheck {
  price: number;
  currency: string;
  checkedAt: string;
  isNewLow: boolean;
  url: string; // link do Google Voos para essa busca
  combo?: ComboResult; // presente quando a melhor opção encontrada foi uma tarifa combinada
}

export interface RouteState {
  route: FlightRoute;
  lowestPrice?: number;
  lowestPriceAt?: string;
  history: PriceCheck[]; // mais recentes primeiro, limitado a MAX_HISTORY
  lastError?: string;
}
