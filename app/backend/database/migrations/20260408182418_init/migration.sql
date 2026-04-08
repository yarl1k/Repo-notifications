-- CreateTable
CREATE TABLE "Repository" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "lastSeenTag" TEXT,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "repositoryId" INTEGER NOT NULL,
    "confirmationToken" TEXT,
    "unsubscribeToken" TEXT,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_email_repositoryId_key" ON "Subscription"("email", "repositoryId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
