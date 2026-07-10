export type SuccessResponse<T> = {
	message: string;
	data?: T;
	pagination?: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
	description?: string;
};

export type ErrorResponse = {
	message: string;
	errors: string[];
};
