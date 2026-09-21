export type CreditPackage = {
  id: string | undefined;
  name: string;
  credits: number;
  price: number;
  description: string;
  popular: boolean;
};

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: process.env.NEXT_PUBLIC_POLAR_STARTER_PRODUCT_ID,
    name: "Starter Pack",
    credits: 100,
    price: 8,
    description: "Perfect for getting started",
    popular: false,
  },
  {
    id: process.env.NEXT_PUBLIC_POLAR_PRO_PRODUCT_ID,
    name: "Pro Pack",
    credits: 200,
    price: 15,
    description: "Best value for power users",
    popular: true,
  },
];

export function getCreditPackage(productId: unknown): CreditPackage | null {
  if (typeof productId !== "string" || productId.length === 0) return null;

  return (
    CREDIT_PACKAGES.find(
      (creditPackage) =>
        creditPackage.id !== undefined && creditPackage.id === productId,
    ) ?? null
  );
}
