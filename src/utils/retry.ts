/**
 * Retry utility for handling transient network errors
 */

/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param maxRetries Maximum number of retries (default: 3)
 * @param baseDelay Base delay in ms (default: 1000)
 * @param maxDelay Maximum delay in ms (default: 10000)
 * @returns Result of the function
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  maxDelay: number = 10000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if this is a retryable error
      const isRetryable = isRetryableError(error);

      // If not retryable or last attempt, throw immediately
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      console.log(
        `⚠️ Retryable error on attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${delay}ms...`
      );
      console.log(`   Error: ${error.message || error}`);

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error("Retry failed");
}

/**
 * Check if an error is retryable
 * @param error Error to check
 * @returns True if the error is retryable
 */
function isRetryableError(error: any): boolean {
  // Check for Towns Protocol network errors
  if (error.code === 9) {
    // FAILED_PRECONDITION
    const message = error.rawMessage || error.message || "";

    // QUORUM_FAILED is retryable (network consensus issue)
    if (message.includes("QUORUM_FAILED")) {
      return true;
    }

    // deadline_exceeded is retryable (timeout)
    if (message.includes("deadline_exceeded")) {
      return true;
    }
  }

  // Check for other network-related errors
  if (error.code === 14) {
    // UNAVAILABLE
    return true;
  }

  if (error.code === 4) {
    // DEADLINE_EXCEEDED
    return true;
  }

  // Check error message for network issues
  const message = (error.message || "").toLowerCase();
  if (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("enotfound")
  ) {
    return true;
  }

  // Not retryable
  return false;
}

