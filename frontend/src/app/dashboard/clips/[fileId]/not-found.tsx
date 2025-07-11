import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-4xl flex-col space-y-8 px-6 py-12">
        <div className="flex items-center space-x-4">
          <Link href="/dashboard">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>

        <Card className="text-center">
          <CardHeader className="pb-4">
            <div className="mx-auto rounded-full bg-muted p-6 mb-4 w-fit">
              <FileX className="h-12 w-12 text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl">File Not Found</CardTitle>
            <CardDescription className="text-base">
              The file you&apos;re looking for doesn&apos;t exist or you don&apos;t have permission to view it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              This could happen if:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 max-w-md mx-auto">
              <li>• The file was deleted</li>
              <li>• You don&apos;t have access to this file</li>
              <li>• The link is incorrect or expired</li>
            </ul>
            <div className="pt-4">
              <Link href="/dashboard">
                <Button className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Return to Dashboard
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 