export type TripType = "oneway" | "roundtrip";

export interface FlightRoute {
  id: string;
  label: string;
  origin: string; // código IATA ou cidade, ex: "GRU"
  destination: string; // código IATA ou cidade, ex: "LIS"
  tripType: TripType;
  departDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD, obrigatório se tripType === "roundtrip"
  whatsappNumber?: string; // número que recebe o alerta dessa rota; sem isso usa o número padrão do .env
  createdAt: string;
}

export interface PriceCheck {
  price: number;
  currency: string;
  checkedAt: string;
  isNewLow: boolean;
  url: string; // link do Google Voos para essa busca
}

export interface RouteState {
  route: FlightRoute;
  lowestPrice?: number;
  lowestPriceAt?: string;
  history: PriceCheck[]; // mais recentes primeiro, limitado a MAX_HISTORY
  lastError?: string;
}
