import { Architecture } from "@/components/landing/Architecture";
import { Benefits } from "@/components/landing/Benefits";
import { CoreInsight } from "@/components/landing/CoreInsight";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Footer } from "@/components/landing/Footer";
import { GridCapacity } from "@/components/landing/GridCapacity";
import { Hero } from "@/components/landing/Hero";
import { Navbar } from "@/components/landing/Navbar";
import { Product } from "@/components/landing/Product";

export default function Home() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <Navbar />
      <main>
        <Hero />
        <Product />
        <Architecture />
        <GridCapacity />
        <CoreInsight />
        <Benefits />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
