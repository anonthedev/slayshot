import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="container mx-auto px-6 py-20 text-center">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-bold text-foreground mb-6">
            Transform YouTube Videos into
            <span className="text-muted-foreground">
              {" "}Viral Clips
            </span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            AI-powered precision to extract the most engaging moments from long videos. 
            Create shareable content that captures attention and drives engagement.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login">
              <Button size="lg" className="px-8 py-3">
                Get Started Free
              </Button>
            </Link>
            <Link href="/pricing">
              <Button size="lg" variant="outline" className="px-8 py-3">
                View Pricing
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-6 py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground text-center mb-12">
            Why Choose Slayshot?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <Card>
              <CardHeader>
                <CardTitle>AI-Powered Detection</CardTitle>
                <CardDescription>
                  Advanced algorithms identify the most engaging moments automatically
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Our AI analyzes video content to find high-impact segments that are most likely to go viral.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Lightning Fast</CardTitle>
                <CardDescription>
                  Process videos in minutes, not hours
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Upload any YouTube video and get your clips ready for social media in record time.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Professional Quality</CardTitle>
                <CardDescription>
                  Broadcast-ready clips with perfect timing
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Each clip is optimized for maximum engagement across all social platforms.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
            Ready to Create Viral Content?
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            Join thousands of creators who are already using Slayshot to boost their social media presence.
          </p>
          <Link href="/login">
            <Button size="lg" className="px-10 py-4 text-lg">
              Start Creating Now
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-8 border-t">
        <div className="text-center text-muted-foreground">
          <p>&copy; 2024 Slayshot. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
