export function getEligibleDonorsForPatient(patientGroup: string): string[] {
  const eligibleDonors: { [key: string]: string[] } = {
    "O-": ["O-"], "O+": ["O-", "O+"], "A-": ["O-", "A-"], "A+": ["O-", "O+", "A-", "A+"],
    "B-": ["O-", "B-"], "B+": ["O-", "O+", "B-", "B+"],
    "AB-": ["O-", "A-", "B-", "AB-"], "AB+": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"]
  };
  return eligibleDonors[patientGroup] || [];
}
