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
  combineStops?: boolean; // tenta achar 2 voos separados (via aeroporto próximo ao destino) mais baratos que o direto; só pra tripType "oneway"
  createdAt: string;
}

export interface ComboLeg {
  price: number;
  currency: string;
  departAt: string; // ISO
  arriveAt: string; // ISO
  url: string;
}

export interface ComboResult {
  via: string; // código IATA do aeroporto de conexão
  leg1: ComboLeg;
  leg2: ComboLeg;
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
