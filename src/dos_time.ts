export function date_from_dos_time(date: number, time: number): Date {
	const hours = ((time >> 11) & 0b11111);
	const minutes = (time >> 5) & 0b111111;
	const seconds = (time & 0b11111) << 1;
	
	const year = ((date >> 9) & 0b1111111) + 1980;
	const month = ((date >> 5) & 0b1111) - 1;
	const day = (date & 0b11111);
	
	return new Date(year, month, day, hours, minutes, seconds);
}

export function dos_time_from_date(input: Date): [number, number] {
	const hours = input.getHours();
	const minutes = input.getMinutes();
	const seconds = input.getSeconds();
	
	const year = input.getFullYear() - 1980;
	const month = input.getMonth() + 1;
	const day = input.getDate();
	
	const time = ((hours & 0b11111) << 11) | ((minutes & 0b111111) << 5) | ((seconds >> 1) & 0b11111);
	const date = ((year & 0b1111111) << 9) | ((month & 0b1111) << 5) | (day & 0b11111);
	
	return [date, time];
}