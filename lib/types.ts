export type ShipAddress = {
  name: string;
  company?: string | null;
  address1: string;
  address2?: string | null;
  city: string;
  province?: string | null;
  zip: string;
  country?: string | null;
  countryCode?: string | null;
  phone?: string | null;
};

export type LineItem = { name: string; quantity: number; sku?: string | null };
